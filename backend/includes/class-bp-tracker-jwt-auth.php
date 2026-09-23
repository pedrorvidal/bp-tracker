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
	 * @var int
	 */
	const ACCESS_TOKEN_TTL = HOUR_IN_SECONDS;

	/**
	 * Refresh token lifetime, in seconds.
	 *
	 * @var int
	 */
	const REFRESH_TOKEN_TTL = 30 * DAY_IN_SECONDS;

	/**
	 * Bump whenever create_tables()'s schema changes, so maybe_upgrade()
	 * re-runs it for sites where the plugin was already active.
	 *
	 * @var string
	 */
	const DB_VERSION = '1.0.0';

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
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
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
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			user_id BIGINT UNSIGNED NOT NULL,
			token_hash CHAR(64) NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY token_hash (token_hash),
			KEY user_id (user_id)
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
				'permission_callback' => '__return_true',
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
				'permission_callback' => '__return_true',
				'args'                => array(
					'refresh_token' => array(
						'required' => true,
						'type'     => 'string',
					),
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/auth/logout',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_logout' ),
				'permission_callback' => array( __CLASS__, 'require_logged_in' ),
				'args'                => array(
					'refresh_token' => array(
						'required' => true,
						'type'     => 'string',
					),
				),
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

		$user = wp_authenticate( $username, $password );

		if ( is_wp_error( $user ) ) {
			return new WP_Error(
				'bp_tracker_jwt_invalid_credentials',
				__( 'Invalid username or password.', 'bp-tracker' ),
				array( 'status' => 403 )
			);
		}

		try {
			return new WP_REST_Response( self::issue_tokens( $user->ID ), 200 );
		} catch ( RuntimeException $e ) {
			return self::misconfigured_error();
		}
	}

	/**
	 * Handles POST /auth/refresh.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function handle_refresh( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$refresh_token = (string) $request->get_param( 'refresh_token' );
		$row           = self::find_valid_refresh_token( $refresh_token );

		if ( null === $row ) {
			return new WP_Error(
				'bp_tracker_jwt_invalid_refresh_token',
				__( 'Invalid or expired refresh token.', 'bp-tracker' ),
				array( 'status' => 401 )
			);
		}

		global $wpdb;
		$wpdb->delete( self::table_name(), array( 'id' => $row->id ), array( '%d' ) );

		try {
			return new WP_REST_Response( self::issue_tokens( (int) $row->user_id ), 200 );
		} catch ( RuntimeException $e ) {
			return self::misconfigured_error();
		}
	}

	/**
	 * Handles POST /auth/logout.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response
	 */
	public static function handle_logout( WP_REST_Request $request ): WP_REST_Response {
		$refresh_token = (string) $request->get_param( 'refresh_token' );

		global $wpdb;
		$wpdb->delete(
			self::table_name(),
			array(
				'token_hash' => self::hash_token( $refresh_token ),
				'user_id'    => get_current_user_id(),
			),
			array( '%s', '%d' )
		);

		return new WP_REST_Response( array( 'success' => true ), 200 );
	}

	/**
	 * Permission callback requiring an authenticated user.
	 *
	 * @return true|WP_Error
	 */
	public static function require_logged_in(): true|WP_Error {
		if ( is_user_logged_in() ) {
			return true;
		}

		return new WP_Error(
			'bp_tracker_jwt_unauthorized',
			__( 'Authentication required.', 'bp-tracker' ),
			array( 'status' => 401 )
		);
	}

	/**
	 * Issues a fresh access/refresh token pair for a user.
	 *
	 * @param int $user_id User ID to issue tokens for.
	 * @return array{access_token: string, refresh_token: string, token_type: string, expires_in: int}
	 *
	 * @throws RuntimeException When BP_TRACKER_JWT_SECRET is not configured.
	 */
	private static function issue_tokens( int $user_id ): array {
		return array(
			'access_token'  => self::create_access_token( $user_id ),
			'refresh_token' => self::create_refresh_token( $user_id ),
			'token_type'    => 'Bearer',
			'expires_in'    => self::ACCESS_TOKEN_TTL,
		);
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
		);

		return JWT::encode( $payload, self::get_secret(), 'HS256' );
	}

	/**
	 * Creates a random refresh token and stores its hash.
	 *
	 * @param int $user_id User ID the token belongs to.
	 * @return string The raw refresh token (never stored as-is).
	 */
	private static function create_refresh_token( int $user_id ): string {
		$token = bin2hex( random_bytes( 32 ) );

		global $wpdb;
		$wpdb->insert(
			self::table_name(),
			array(
				'user_id'    => $user_id,
				'token_hash' => self::hash_token( $token ),
				'expires_at' => gmdate( 'Y-m-d H:i:s', time() + self::REFRESH_TOKEN_TTL ),
				'created_at' => gmdate( 'Y-m-d H:i:s' ),
			),
			array( '%d', '%s', '%s', '%s' )
		);

		return $token;
	}

	/**
	 * Looks up a non-expired refresh token by its raw value.
	 *
	 * @param string $token Raw refresh token.
	 * @return object{id: int, user_id: int, expires_at: string}|null
	 */
	private static function find_valid_refresh_token( string $token ): ?object {
		global $wpdb;

		$table = self::table_name();
		$hash  = self::hash_token( $token );

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is our own prefixed table name, never user input; wpdb::prepare() cannot placeholder identifiers.
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT id, user_id, expires_at FROM {$table} WHERE token_hash = %s", $hash ) );

		if ( ! $row ) {
			return null;
		}

		if ( strtotime( (string) $row->expires_at ) < time() ) {
			return null;
		}

		return $row;
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
	private static function table_name(): string {
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
			$decoded = JWT::decode( $token, new Key( self::get_secret(), 'HS256' ) );
		} catch ( Throwable $e ) {
			self::$auth_error = self::invalid_token_error();
			return $user_id;
		}

		$decoded_user_id = isset( $decoded->user_id ) ? (int) $decoded->user_id : 0;

		if ( $decoded_user_id <= 0 || ! get_userdata( $decoded_user_id ) ) {
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
