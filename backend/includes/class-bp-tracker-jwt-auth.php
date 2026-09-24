<?php
/**
 * First-party JWT authentication for the plugin's REST endpoints.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_JWT_Auth
 */
class BP_Tracker_JWT_Auth {

	/**
	 * REST namespace every auth route lives under.
	 *
	 * @var string
	 */
	const REST_NAMESPACE = 'bp-tracker/v1';

	/**
	 * Access token lifetime, in seconds.
	 *
	 * Short, since a JWT can't be revoked individually: it bounds how long a
	 * leaked access token stays usable. Refreshing is transparent to users.
	 *
	 * @var int
	 */
	const ACCESS_TOKEN_TTL = 15 * MINUTE_IN_SECONDS;

	/**
	 * Refresh token lifetime, in seconds.
	 *
	 * @var int
	 */
	const REFRESH_TOKEN_TTL = 30 * DAY_IN_SECONDS;

	/**
	 * Name of the HttpOnly cookie carrying the refresh token.
	 *
	 * @var string
	 */
	const REFRESH_COOKIE = 'bp_tracker_refresh';

	/**
	 * Request header every auth route requires (value "1").
	 *
	 * The refresh cookie is sent by the browser automatically, so a custom
	 * header is required to prove the request came from our own frontend:
	 * browsers only send custom headers cross-origin after a CORS preflight,
	 * which BP_Tracker_CORS only grants to the configured frontend origin.
	 *
	 * @var string
	 */
	const CSRF_HEADER = 'X-BP-Tracker-CSRF';

	/**
	 * Bump whenever create_tables()'s schema changes, so maybe_upgrade()
	 * re-runs it for sites where the plugin was already active.
	 *
	 * @var string
	 */
	const DB_VERSION = '1.1.0';

	/**
	 * Option storing the refresh token table's currently installed schema version.
	 *
	 * @var string
	 */
	const DB_VERSION_OPTION = 'bp_tracker_jwt_auth_db_version';

	/**
	 * Authentication error raised by validate_token(), if any, for the
	 * current request. Read by maybe_return_auth_error().
	 *
	 * @var WP_Error|null
	 */
	private static ?WP_Error $auth_error = null;

	/**
	 * Wires up routes, table creation and the Bearer-token auth pipeline.
	 */
	public static function init(): void {
		register_activation_hook( BP_TRACKER_FILE, array( __CLASS__, 'create_tables' ) );
		add_action( 'plugins_loaded', array( __CLASS__, 'maybe_upgrade' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_filter( 'determine_current_user', array( __CLASS__, 'validate_token' ), 20 );
		add_filter( 'rest_authentication_errors', array( __CLASS__, 'maybe_return_auth_error' ) );
	}

	/**
	 * Creates the refresh token table if its schema version changed.
	 *
	 * Activating a plugin that is already active is a no-op in WordPress,
	 * so register_activation_hook() alone misses sites that had an older
	 * version of the plugin active when this table was introduced/changed.
	 */
	public static function maybe_upgrade(): void {
		if ( get_option( self::DB_VERSION_OPTION ) === self::DB_VERSION ) {
			return;
		}

		self::create_tables();
		self::backfill_family_ids();
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * Gives every refresh token created before families existed (schema
	 * 1.0.0) a family of its own, so no two legacy sessions share one and a
	 * revocation never spreads across them.
	 */
	private static function backfill_family_ids(): void {
		global $wpdb;

		$table = self::table_name();

		$wpdb->query( $wpdb->prepare( "UPDATE %i SET family_id = MD5( CONCAT( id, '-', token_hash ) ) WHERE family_id = ''", $table ) );
	}

	/**
	 * Creates (or updates) the refresh token table.
	 */
	public static function create_tables(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table_name      = self::table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table_name} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			user_id bigint(20) unsigned NOT NULL,
			family_id CHAR(32) NOT NULL DEFAULT '',
			token_hash CHAR(64) NOT NULL,
			expires_at DATETIME NOT NULL,
			used_at DATETIME NULL DEFAULT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY token_hash (token_hash),
			KEY user_id (user_id),
			KEY family_id (family_id)
		) {$charset_collate};";

		dbDelta( $sql );
	}

	/**
	 * Registers the login/refresh/logout routes.
	 */
	public static function register_routes(): void {
		register_rest_route(
			self::REST_NAMESPACE,
			'/auth/login',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_login' ),
				'permission_callback' => array( __CLASS__, 'require_csrf_header' ),
				'args'                => array(
					'username' => array(
						'required' => true,
						'type'     => 'string',
					),
					'password' => array(
						'required' => true,
						'type'     => 'string',
					),
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/auth/refresh',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_refresh' ),
				'permission_callback' => array( __CLASS__, 'require_csrf_header' ),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/auth/logout',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_logout' ),
				'permission_callback' => array( __CLASS__, 'require_csrf_header' ),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/auth/logout-all',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_logout_all' ),
				'permission_callback' => array( __CLASS__, 'require_csrf_header' ),
			)
		);
	}

	/**
	 * Handles POST /auth/login.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function handle_login( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$username = (string) $request->get_param( 'username' );
		$password = (string) $request->get_param( 'password' );
		$ip       = BP_Tracker_Rate_Limiter::client_ip();

		// Checked before the password, so a correct guess can't be confirmed
		// while locked out.
		$retry_after = BP_Tracker_Rate_Limiter::login_retry_after( $username, $ip );

		if ( $retry_after > 0 ) {
			return BP_Tracker_Rate_Limiter::too_many_requests(
				'bp_tracker_jwt_too_many_attempts',
				__( 'Too many failed login attempts. Try again later.', 'bp-tracker' ),
				$retry_after
			);
		}

		$user = wp_authenticate( $username, $password );

		if ( is_wp_error( $user ) ) {
			BP_Tracker_Rate_Limiter::record_login_failure( $username, $ip );

			return new WP_Error(
				'bp_tracker_jwt_invalid_credentials',
				__( 'Invalid username or password.', 'bp-tracker' ),
				array( 'status' => 403 )
			);
		}

		// Checked only after the password, so it can't be used to find out
		// which accounts are pending. The counters are not cleared for a
		// pending account: signing up must not be a way to reset them.
		if ( BP_Tracker_Roles::is_pending( $user ) ) {
			return new WP_Error(
				'bp_tracker_jwt_account_pending',
				__( 'Your account is pending approval.', 'bp-tracker' ),
				array( 'status' => 403 )
			);
		}

		BP_Tracker_Rate_Limiter::clear_login( $username, $ip );

		try {
			return self::token_response( $user );
		} catch ( RuntimeException $e ) {
			return self::misconfigured_error();
		}
	}

	/**
	 * Handles POST /auth/refresh: exchanges the refresh cookie for a new pair.
	 *
	 * The presented token is marked used (rotation) and its successor joins
	 * the same family. Presenting a token that was already used means a copy
	 * of it exists: the whole family is revoked (see revoke_reused_family()).
	 *
	 * @return WP_REST_Response|WP_Error
	 */
	public static function handle_refresh(): WP_REST_Response|WP_Error {
		$row = self::active_presented_token();

		if ( null === $row ) {
			return self::invalid_refresh_response();
		}

		$user = get_userdata( (int) $row->user_id );

		if ( false === $user ) {
			return self::invalid_refresh_response();
		}

		// A user made pending again loses every session (see
		// BP_Tracker_Roles::revoke_if_pending()); this is the backstop.
		if ( BP_Tracker_Roles::is_pending( $user ) ) {
			BP_Tracker_Sessions::revoke_all( $user->ID );
			return self::invalid_refresh_response();
		}

		// Consume the token atomically: of several concurrent requests
		// presenting it, only the one whose UPDATE marks it used proceeds.
		// Losing that race means another request used the same token at the
		// same moment, which is reuse too.
		global $wpdb;
		$table = self::table_name();

		$consumed = $wpdb->query( $wpdb->prepare( 'UPDATE %i SET used_at = %s WHERE id = %d AND used_at IS NULL', $table, gmdate( 'Y-m-d H:i:s' ), $row->id ) );

		if ( 1 !== $consumed ) {
			self::revoke_reused_family( $row );
			return self::invalid_refresh_response();
		}

		try {
			return self::token_response( $user, (string) $row->family_id );
		} catch ( RuntimeException $e ) {
			return self::misconfigured_error();
		}
	}

	/**
	 * Resolves the refresh cookie to an unused, unexpired token row.
	 *
	 * A token that was already used triggers reuse handling (its family is
	 * revoked) and resolves to null, like an unknown or expired one.
	 *
	 * @return object{id: int, user_id: int, family_id: string, expires_at: string, used_at: string|null}|null
	 */
	private static function active_presented_token(): ?object {
		$refresh_token = self::get_refresh_cookie();
		$row           = null === $refresh_token ? null : self::find_refresh_token( $refresh_token );

		if ( null === $row ) {
			return null;
		}

		if ( null !== $row->used_at ) {
			self::revoke_reused_family( $row );
			return null;
		}

		if ( strtotime( (string) $row->expires_at ) < time() ) {
			return null;
		}

		return $row;
	}

	/**
	 * Revokes a token family after one of its tokens was used twice.
	 *
	 * Reuse means someone holds a copy of the token: either an attacker used
	 * it first and the real client presents the old one, or the reverse.
	 * Revoking the whole family ends both. Other sessions of the user (other
	 * families) are untouched.
	 *
	 * @param object{user_id: int, family_id: string} $row The reused token's row.
	 */
	private static function revoke_reused_family( object $row ): void {
		self::revoke_family( (string) $row->family_id );

		/**
		 * Fires when a refresh token is presented after it was already used,
		 * which usually means it was stolen. Hook in to log or alert.
		 *
		 * @param int    $user_id   Owner of the token.
		 * @param string $family_id The revoked family.
		 */
		do_action( 'bp_tracker_refresh_token_reuse_detected', (int) $row->user_id, (string) $row->family_id );
	}

	/**
	 * Deletes every token of a family (the whole session).
	 *
	 * @param string $family_id Family ID.
	 */
	private static function revoke_family( string $family_id ): void {
		global $wpdb;

		if ( '' === $family_id ) {
			return;
		}

		$wpdb->delete( self::table_name(), array( 'family_id' => $family_id ), array( '%s' ) );
	}

	/**
	 * Builds the 401 for an unusable refresh token, clearing the stale cookie
	 * so the browser stops sending it.
	 *
	 * @return WP_REST_Response
	 */
	private static function invalid_refresh_response(): WP_REST_Response {
		$response = new WP_REST_Response(
			array(
				'code'    => 'bp_tracker_jwt_invalid_refresh_token',
				'message' => __( 'Invalid or expired refresh token.', 'bp-tracker' ),
				'data'    => array( 'status' => 401 ),
			),
			401
		);
		$response->header( 'Set-Cookie', self::build_refresh_cookie( '', 0 ) );

		return $response;
	}

	/**
	 * Handles POST /auth/logout: ends the cookie's session and clears it.
	 *
	 * Revokes the token's whole family, so a copy an attacker might have
	 * rotated is ended too. Needs no access token: holding the refresh token
	 * proves the right to revoke it, and logout must work even after the
	 * access token expired.
	 *
	 * @return WP_REST_Response
	 */
	public static function handle_logout(): WP_REST_Response {
		$refresh_token = self::get_refresh_cookie();
		$row           = null === $refresh_token ? null : self::find_refresh_token( $refresh_token );

		if ( null !== $row ) {
			self::revoke_family( (string) $row->family_id );
		}

		$response = new WP_REST_Response( array( 'success' => true ), 200 );
		$response->header( 'Set-Cookie', self::build_refresh_cookie( '', 0 ) );

		return $response;
	}

	/**
	 * Handles POST /auth/logout-all: signs the user out of every device.
	 *
	 * Authenticated by the refresh cookie, like logout. Deletes all of the
	 * user's refresh tokens and rejects every access token issued so far.
	 *
	 * @return WP_REST_Response
	 */
	public static function handle_logout_all(): WP_REST_Response {
		$row = self::active_presented_token();

		if ( null === $row ) {
			return self::invalid_refresh_response();
		}

		$revoked = BP_Tracker_Sessions::revoke_all( (int) $row->user_id );

		$response = new WP_REST_Response(
			array(
				'success'          => true,
				'revoked_sessions' => $revoked,
			),
			200
		);
		$response->header( 'Set-Cookie', self::build_refresh_cookie( '', 0 ) );

		return $response;
	}

	/**
	 * Permission callback for the auth routes: requires the CSRF header.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	public static function require_csrf_header( WP_REST_Request $request ): true|WP_Error {
		if ( '1' === $request->get_header( self::CSRF_HEADER ) ) {
			return true;
		}

		return new WP_Error(
			'bp_tracker_jwt_missing_csrf_header',
			/* translators: %s: header name. */
			sprintf( __( 'Missing the %s header.', 'bp-tracker' ), self::CSRF_HEADER ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Builds the Set-Cookie header value for the refresh token.
	 *
	 * HttpOnly keeps it away from JavaScript (and so from XSS); SameSite=Strict
	 * keeps other sites from sending it; the path limits it to the auth routes;
	 * Secure is set whenever the site is served over HTTPS.
	 *
	 * @param string $value   Raw refresh token, or '' to clear the cookie.
	 * @param int    $max_age Lifetime in seconds; 0 deletes the cookie.
	 * @return string
	 */
	public static function build_refresh_cookie( string $value, int $max_age ): string {
		$attributes = array(
			self::REFRESH_COOKIE . '=' . rawurlencode( $value ),
			'Path=' . self::cookie_path(),
			'Max-Age=' . max( 0, $max_age ),
			'HttpOnly',
			'SameSite=Strict',
		);

		/**
		 * Filters whether the refresh cookie gets the Secure attribute.
		 *
		 * Defaults to is_ssl(). Return true when TLS is terminated by a proxy
		 * that WordPress doesn't detect.
		 *
		 * @param bool $secure Whether to mark the cookie Secure.
		 */
		if ( (bool) apply_filters( 'bp_tracker_refresh_cookie_secure', is_ssl() ) ) {
			$attributes[] = 'Secure';
		}

		return implode( '; ', $attributes );
	}

	/**
	 * Path the refresh cookie is scoped to: this namespace's auth routes.
	 *
	 * @return string
	 */
	private static function cookie_path(): string {
		$path = wp_parse_url( rest_url( self::REST_NAMESPACE . '/auth' ), PHP_URL_PATH );

		// Plain permalinks route the REST API through "/?rest_route=".
		if ( ! is_string( $path ) || ! str_contains( $path, self::REST_NAMESPACE ) ) {
			return '/';
		}

		return untrailingslashit( $path );
	}

	/**
	 * Reads a well-formed refresh token from the request cookie.
	 *
	 * @return string|null
	 */
	private static function get_refresh_cookie(): ?string {
		if ( ! isset( $_COOKIE[ self::REFRESH_COOKIE ] ) || ! is_string( $_COOKIE[ self::REFRESH_COOKIE ] ) ) {
			return null;
		}

		$token = sanitize_text_field( wp_unslash( $_COOKIE[ self::REFRESH_COOKIE ] ) );

		// Tokens are 32 random bytes, hex-encoded.
		return 1 === preg_match( '/^[0-9a-f]{64}$/', $token ) ? $token : null;
	}

	/**
	 * Issues a fresh token pair for a user: the access token in the body,
	 * the refresh token in the HttpOnly cookie.
	 *
	 * @param WP_User     $user      User to issue tokens for.
	 * @param string|null $family_id Family of the refresh token being rotated,
	 *                               or null to start a new one (login).
	 * @return WP_REST_Response
	 *
	 * @throws RuntimeException When BP_TRACKER_JWT_SECRET is not configured.
	 */
	private static function token_response( WP_User $user, ?string $family_id = null ): WP_REST_Response {
		$response = new WP_REST_Response(
			array(
				'access_token' => self::create_access_token( $user->ID ),
				'token_type'   => 'Bearer',
				'expires_in'   => self::ACCESS_TOKEN_TTL,
				'user'         => array(
					'id'           => $user->ID,
					'username'     => $user->user_login,
					'display_name' => $user->display_name,
				),
			),
			200
		);

		$response->header(
			'Set-Cookie',
			self::build_refresh_cookie(
				self::create_refresh_token( $user->ID, $family_id ?? bin2hex( random_bytes( 16 ) ) ),
				self::REFRESH_TOKEN_TTL
			)
		);

		return $response;
	}

	/**
	 * Builds the standard "misconfigured" REST error.
	 *
	 * @return WP_Error
	 */
	private static function misconfigured_error(): WP_Error {
		return new WP_Error(
			'bp_tracker_jwt_misconfigured',
			__( 'JWT authentication is not configured.', 'bp-tracker' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * Creates a signed access token (JWT) for a user.
	 *
	 * @param int $user_id User ID the token authenticates.
	 * @return string
	 *
	 * @throws RuntimeException When BP_TRACKER_JWT_SECRET is not configured.
	 */
	private static function create_access_token( int $user_id ): string {
		$issued_at = time();

		$payload = array(
			'iss'     => get_bloginfo( 'url' ),
			'iat'     => $issued_at,
			'exp'     => $issued_at + self::ACCESS_TOKEN_TTL,
			'jti'     => wp_generate_uuid4(),
			'user_id' => $user_id,
			'gen'     => BP_Tracker_Sessions::generation( $user_id ),
		);

		return JWT::encode( $payload, self::get_secret(), 'HS256' );
	}

	/**
	 * Creates a random refresh token in a family and stores its hash.
	 *
	 * @param int    $user_id   User ID the token belongs to.
	 * @param string $family_id Family (session) the token belongs to.
	 * @return string The raw refresh token (never stored as-is).
	 */
	private static function create_refresh_token( int $user_id, string $family_id ): string {
		$token = bin2hex( random_bytes( 32 ) );

		global $wpdb;
		$wpdb->insert(
			self::table_name(),
			array(
				'user_id'    => $user_id,
				'family_id'  => $family_id,
				'token_hash' => self::hash_token( $token ),
				'expires_at' => gmdate( 'Y-m-d H:i:s', time() + self::REFRESH_TOKEN_TTL ),
				'created_at' => gmdate( 'Y-m-d H:i:s' ),
			),
			array( '%d', '%s', '%s', '%s', '%s' )
		);

		return $token;
	}

	/**
	 * Looks up a refresh token by its raw value, whatever its state.
	 *
	 * @param string $token Raw refresh token.
	 * @return object{id: int, user_id: int, family_id: string, expires_at: string, used_at: string|null}|null
	 */
	private static function find_refresh_token( string $token ): ?object {
		global $wpdb;

		$table = self::table_name();

		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT id, user_id, family_id, expires_at, used_at FROM %i WHERE token_hash = %s', $table, self::hash_token( $token ) ) );

		return is_object( $row ) ? $row : null;
	}

	/**
	 * Hashes a raw token for storage/lookup.
	 *
	 * @param string $token Raw token.
	 * @return string
	 */
	private static function hash_token( string $token ): string {
		return hash( 'sha256', $token );
	}

	/**
	 * Returns the refresh token table's fully prefixed name.
	 *
	 * @return string
	 */
	public static function table_name(): string {
		global $wpdb;

		return $wpdb->prefix . 'bp_tracker_refresh_tokens';
	}

	/**
	 * Reads the JWT signing secret from wp-config.php.
	 *
	 * @return string
	 *
	 * @throws RuntimeException When BP_TRACKER_JWT_SECRET is not configured.
	 */
	private static function get_secret(): string {
		if ( ! defined( 'BP_TRACKER_JWT_SECRET' ) ) {
			throw new RuntimeException( 'BP_TRACKER_JWT_SECRET is not defined.' );
		}

		$secret = constant( 'BP_TRACKER_JWT_SECRET' );

		if ( ! is_string( $secret ) || '' === $secret ) {
			throw new RuntimeException( 'BP_TRACKER_JWT_SECRET must be a non-empty string.' );
		}

		return $secret;
	}

	/**
	 * Resolves the current user from a Bearer access token, if present.
	 *
	 * Hooked to "determine_current_user" so REST (and any other) requests
	 * carrying a valid access token authenticate as that user, exactly like
	 * WordPress' own cookie-based auth would.
	 *
	 * @param mixed $user_id User ID resolved so far by earlier callbacks.
	 * @return mixed
	 */
	public static function validate_token( mixed $user_id ): mixed {
		self::$auth_error = null;

		$token = self::get_bearer_token();

		if ( null === $token ) {
			return $user_id;
		}

		try {
			// The algorithm is fixed here, never taken from the token: php-jwt
			// rejects any token whose header "alg" isn't this key's (HS256),
			// including "none" (algorithm confusion).
			$decoded = JWT::decode( $token, new Key( self::get_secret(), 'HS256' ) );
		} catch ( Throwable $e ) {
			self::$auth_error = self::invalid_token_error();
			return $user_id;
		}

		$decoded_user_id = isset( $decoded->user_id ) ? (int) $decoded->user_id : 0;

		// Tokens from a revoked session generation (or issued before
		// generations existed) are rejected.
		$generation = isset( $decoded->gen ) && is_int( $decoded->gen ) ? $decoded->gen : -1;

		if (
			$decoded_user_id <= 0
			|| ! get_userdata( $decoded_user_id )
			|| BP_Tracker_Sessions::generation( $decoded_user_id ) !== $generation
		) {
			self::$auth_error = self::invalid_token_error();
			return $user_id;
		}

		return $decoded_user_id;
	}

	/**
	 * Builds the standard "invalid token" REST error.
	 *
	 * @return WP_Error
	 */
	private static function invalid_token_error(): WP_Error {
		return new WP_Error(
			'bp_tracker_jwt_invalid_token',
			__( 'Invalid or expired access token.', 'bp-tracker' ),
			array( 'status' => 401 )
		);
	}

	/**
	 * Reads and validates the "Authorization: Bearer <token>" header.
	 *
	 * @return string|null
	 */
	private static function get_bearer_token(): ?string {
		$header = '';

		if ( isset( $_SERVER['HTTP_AUTHORIZATION'] ) ) {
			$header = sanitize_text_field( wp_unslash( $_SERVER['HTTP_AUTHORIZATION'] ) );
		} elseif ( isset( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) ) {
			$header = sanitize_text_field( wp_unslash( $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ) );
		} elseif ( function_exists( 'getallheaders' ) ) {
			$headers = getallheaders();
			if ( isset( $headers['Authorization'] ) ) {
				$header = sanitize_text_field( $headers['Authorization'] );
			}
		}

		if ( '' === $header || ! str_starts_with( $header, 'Bearer ' ) ) {
			return null;
		}

		return trim( substr( $header, 7 ) );
	}

	/**
	 * Surfaces validate_token()'s error to the REST API, if any.
	 *
	 * @param mixed $result Result of previous "rest_authentication_errors" callbacks.
	 * @return mixed
	 */
	public static function maybe_return_auth_error( mixed $result ): mixed {
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return self::$auth_error ?? $result;
	}
}

BP_Tracker_JWT_Auth::init();
