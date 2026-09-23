<?php
/**
 * Tests for BP_Tracker_JWT_Auth.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

/**
 * Class BP_Tracker_JWT_Auth_Test
 */
class BP_Tracker_JWT_Auth_Test extends WP_UnitTestCase {

	/**
	 * The user created for each test.
	 *
	 * @var int
	 */
	private int $user_id;

	/**
	 * Plaintext password for $user_id.
	 *
	 * @var string
	 */
	private string $password = 'correct horse battery staple';

	/**
	 * Creates a test user with a known password.
	 */
	public function setUp(): void {
		parent::setUp();

		$this->user_id = self::factory()->user->create(
			array(
				'role'       => 'administrator',
				'user_login' => 'bp-tracker-tester',
				'user_pass'  => $this->password,
			)
		);
	}

	/**
	 * Clears any Bearer token / cached current user left over by a test.
	 */
	public function tearDown(): void {
		unset( $_SERVER['HTTP_AUTHORIZATION'], $_COOKIE[ BP_Tracker_JWT_Auth::REFRESH_COOKIE ] );
		unset( $GLOBALS['current_user'] );
		wp_set_current_user( 0 );

		parent::tearDown();
	}

	/**
	 * Simulates the request carrying a Bearer access token.
	 *
	 * @param string $token Access token.
	 */
	private function set_bearer_token( string $token ): void {
		$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
		unset( $GLOBALS['current_user'] );
	}

	/**
	 * Dispatches a REST request and returns its response.
	 *
	 * @param string               $method HTTP method.
	 * @param string               $route  Route, including leading slash.
	 * @param array<string, mixed> $params Body params.
	 * @param bool                 $csrf   Whether to send the CSRF header.
	 * @return WP_REST_Response
	 */
	private function dispatch( string $method, string $route, array $params = array(), bool $csrf = true ): WP_REST_Response {
		$request = new WP_REST_Request( $method, $route );

		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		if ( $csrf ) {
			$request->set_header( BP_Tracker_JWT_Auth::CSRF_HEADER, '1' );
		}

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Logs the test user in.
	 *
	 * @return WP_REST_Response
	 */
	private function login(): WP_REST_Response {
		return $this->dispatch(
			'POST',
			'/bp-tracker/v1/auth/login',
			array(
				'username' => 'bp-tracker-tester',
				'password' => $this->password,
			)
		);
	}

	/**
	 * Returns the raw Set-Cookie header of a response, or null.
	 *
	 * @param WP_REST_Response $response Response.
	 * @return string|null
	 */
	private function set_cookie_header( WP_REST_Response $response ): ?string {
		$headers = $response->get_headers();

		return isset( $headers['Set-Cookie'] ) ? (string) $headers['Set-Cookie'] : null;
	}

	/**
	 * Extracts the refresh token a response set in its cookie.
	 *
	 * @param WP_REST_Response $response Response.
	 * @return string
	 */
	private function refresh_token_from( WP_REST_Response $response ): string {
		$header = (string) $this->set_cookie_header( $response );
		$this->assertMatchesRegularExpression( '/^' . BP_Tracker_JWT_Auth::REFRESH_COOKIE . '=([0-9a-f]{64});/', $header );

		return (string) preg_replace( '/^[^=]+=([^;]*);.*$/', '$1', $header );
	}

	/**
	 * Simulates the browser sending the refresh cookie.
	 *
	 * @param string $token Refresh token.
	 */
	private function send_refresh_cookie( string $token ): void {
		$_COOKIE[ BP_Tracker_JWT_Auth::REFRESH_COOKIE ] = $token;
	}

	/**
	 * Counts rows in the refresh token table.
	 *
	 * @return int
	 */
	private function count_refresh_tokens(): int {
		global $wpdb;

		$table = $wpdb->prefix . 'bp_tracker_refresh_tokens';

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is our own prefixed table name, never user input.
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
	}

	/**
	 * Asserts that a response deletes the refresh cookie.
	 *
	 * @param WP_REST_Response $response Response.
	 */
	private function assert_clears_refresh_cookie( WP_REST_Response $response ): void {
		$header = (string) $this->set_cookie_header( $response );

		$this->assertStringStartsWith( BP_Tracker_JWT_Auth::REFRESH_COOKIE . '=;', $header );
		$this->assertStringContainsString( 'Max-Age=0', $header );
	}

	/**
	 * A valid login returns the access token and user in the body, and the
	 * refresh token only in an HttpOnly cookie.
	 */
	public function test_login_with_valid_credentials_returns_tokens(): void {
		$response = $this->login();
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertArrayHasKey( 'access_token', $data );
		$this->assertArrayNotHasKey( 'refresh_token', $data, 'The refresh token must never be readable by JavaScript.' );
		$this->assertSame( 'Bearer', $data['token_type'] );
		$this->assertSame( 15 * MINUTE_IN_SECONDS, $data['expires_in'] );
		$this->assertSame(
			array(
				'id'           => $this->user_id,
				'username'     => 'bp-tracker-tester',
				'display_name' => get_userdata( $this->user_id )->display_name,
			),
			$data['user']
		);

		$decoded = JWT::decode( $data['access_token'], new Key( BP_TRACKER_JWT_SECRET, 'HS256' ) );
		$this->assertSame( $this->user_id, (int) $decoded->user_id );

		$refresh_token = $this->refresh_token_from( $response );
		$this->assertSame( 1, $this->count_refresh_tokens() );

		global $wpdb;
		$table = $wpdb->prefix . 'bp_tracker_refresh_tokens';
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is our own prefixed table name, never user input.
		$stored_hash = $wpdb->get_var( "SELECT token_hash FROM {$table}" );
		$this->assertSame( hash( 'sha256', $refresh_token ), $stored_hash, 'Only the hash is stored.' );
	}

	/**
	 * The refresh cookie is HttpOnly, SameSite=Strict, scoped to the auth
	 * routes and lives as long as the refresh token.
	 */
	public function test_refresh_cookie_attributes(): void {
		$this->set_permalink_structure( '/%postname%/' );

		$header = (string) $this->set_cookie_header( $this->login() );
		$parts  = array_map( 'trim', explode( ';', $header ) );

		$this->assertContains( 'HttpOnly', $parts );
		$this->assertContains( 'SameSite=Strict', $parts );
		$this->assertContains( 'Max-Age=' . BP_Tracker_JWT_Auth::REFRESH_TOKEN_TTL, $parts );
		$this->assertContains( 'Path=/wp-json/bp-tracker/v1/auth', $parts );
	}

	/**
	 * With plain permalinks the REST API lives at "/?rest_route=", which a
	 * cookie path can't target, so the cookie falls back to "/".
	 */
	public function test_refresh_cookie_path_with_plain_permalinks(): void {
		$this->set_permalink_structure( '' );

		$parts = array_map( 'trim', explode( ';', (string) $this->set_cookie_header( $this->login() ) ) );

		$this->assertContains( 'Path=/', $parts );
	}

	/**
	 * The cookie is Secure over HTTPS (or when the filter says so), and not
	 * otherwise, so local http:// development still works.
	 */
	public function test_refresh_cookie_secure_flag_follows_the_filter(): void {
		add_filter( 'bp_tracker_refresh_cookie_secure', '__return_true' );
		$this->assertStringEndsWith( '; Secure', BP_Tracker_JWT_Auth::build_refresh_cookie( 'abc', 60 ) );

		add_filter( 'bp_tracker_refresh_cookie_secure', '__return_false', 20 );
		$this->assertStringNotContainsString( 'Secure', BP_Tracker_JWT_Auth::build_refresh_cookie( 'abc', 60 ) );
	}

	/**
	 * An invalid password is rejected with 403 and no tokens are issued.
	 */
	public function test_login_with_invalid_credentials_is_rejected(): void {
		$response = $this->dispatch(
			'POST',
			'/bp-tracker/v1/auth/login',
			array(
				'username' => 'bp-tracker-tester',
				'password' => 'definitely-wrong',
			)
		);

		$this->assertSame( 403, $response->get_status() );
		$this->assertArrayNotHasKey( 'access_token', $response->get_data() );
		$this->assertNull( $this->set_cookie_header( $response ) );
		$this->assertSame( 0, $this->count_refresh_tokens() );
	}

	/**
	 * Every auth route requires the CSRF header, so another site can't make
	 * a victim's browser log in, refresh or log out with its cookie.
	 *
	 * @dataProvider provide_auth_routes
	 *
	 * @param string $route Auth route.
	 */
	public function test_auth_routes_require_the_csrf_header( string $route ): void {
		$login = $this->login();
		$this->send_refresh_cookie( $this->refresh_token_from( $login ) );

		$response = $this->dispatch(
			'POST',
			$route,
			array(
				'username' => 'bp-tracker-tester',
				'password' => $this->password,
			),
			false
		);

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 'bp_tracker_jwt_missing_csrf_header', $response->get_data()['code'] );
		$this->assertNull( $this->set_cookie_header( $response ) );
		$this->assertSame( 1, $this->count_refresh_tokens(), 'Nothing was issued, rotated or revoked.' );
	}

	/**
	 * Auth routes.
	 *
	 * @return array<string, array{0: string}>
	 */
	public static function provide_auth_routes(): array {
		return array(
			'login'      => array( '/bp-tracker/v1/auth/login' ),
			'refresh'    => array( '/bp-tracker/v1/auth/refresh' ),
			'logout'     => array( '/bp-tracker/v1/auth/logout' ),
			'logout-all' => array( '/bp-tracker/v1/auth/logout-all' ),
		);
	}

	/**
	 * A CSRF header with any value other than "1" is rejected.
	 */
	public function test_csrf_header_must_be_exactly_one(): void {
		$request = new WP_REST_Request( 'POST', '/bp-tracker/v1/auth/refresh' );
		$request->set_header( BP_Tracker_JWT_Auth::CSRF_HEADER, 'yes' );

		$this->assertSame( 403, rest_get_server()->dispatch( $request )->get_status() );
	}

	/**
	 * A valid refresh cookie yields a new access token and a rotated cookie;
	 * the old refresh token stops working.
	 */
	public function test_refresh_with_valid_cookie_rotates_it(): void {
		$old_refresh = $this->refresh_token_from( $this->login() );
		$this->send_refresh_cookie( $old_refresh );

		$refresh = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh' );
		$data    = $refresh->get_data();

		$this->assertSame( 200, $refresh->get_status() );
		$this->assertArrayHasKey( 'access_token', $data );
		$this->assertArrayNotHasKey( 'refresh_token', $data );
		$this->assertSame( $this->user_id, $data['user']['id'] );

		$new_refresh = $this->refresh_token_from( $refresh );
		$this->assertNotSame( $old_refresh, $new_refresh );
		$this->assertSame( 1, $this->count_refresh_tokens() );

		// The old refresh token was invalidated by rotation.
		$this->send_refresh_cookie( $old_refresh );
		$reuse = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh' );
		$this->assertSame( 401, $reuse->get_status() );
		$this->assert_clears_refresh_cookie( $reuse );
	}

	/**
	 * Two requests presenting the same refresh token at once must not both
	 * succeed. Simulated deterministically: right before this request's DELETE
	 * runs, "another request" consumes the row first.
	 */
	public function test_refresh_token_cannot_be_consumed_twice_concurrently(): void {
		global $wpdb;

		$refresh_token = $this->refresh_token_from( $this->login() );
		$table         = $wpdb->prefix . 'bp_tracker_refresh_tokens';
		$raced         = false;

		add_filter(
			'query',
			static function ( string $query ) use ( $table, &$raced ): string {
				if ( ! $raced && str_starts_with( $query, "DELETE FROM `{$table}`" ) ) {
					$raced = true;
					// The concurrent request wins the race and consumes the token.
					$wpdb = $GLOBALS['wpdb'];
					// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery -- test-only simulation on our own table.
					$wpdb->query( "DELETE FROM {$table}" );
				}
				return $query;
			}
		);

		$this->send_refresh_cookie( $refresh_token );
		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh' );

		$this->assertTrue( $raced, 'The race was simulated.' );
		$this->assertSame( 401, $response->get_status() );
		$this->assertArrayNotHasKey( 'access_token', $response->get_data() );
		$this->assertSame( 0, $this->count_refresh_tokens(), 'No new refresh token was issued.' );
	}

	/**
	 * Without a cookie, or with a malformed one, refresh is rejected and the
	 * cookie is cleared.
	 *
	 * @dataProvider provide_bad_refresh_cookies
	 *
	 * @param string|null $cookie Cookie value, or null for no cookie.
	 */
	public function test_refresh_without_a_usable_cookie_is_rejected( ?string $cookie ): void {
		if ( null !== $cookie ) {
			$this->send_refresh_cookie( $cookie );
		}

		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh' );

		$this->assertSame( 401, $response->get_status() );
		$this->assertSame( 'bp_tracker_jwt_invalid_refresh_token', $response->get_data()['code'] );
		$this->assert_clears_refresh_cookie( $response );
	}

	/**
	 * Refresh cookies that must be rejected.
	 *
	 * @return array<string, array{0: string|null}>
	 */
	public static function provide_bad_refresh_cookies(): array {
		return array(
			'no cookie'           => array( null ),
			'empty'               => array( '' ),
			'too short'           => array( str_repeat( 'a', 63 ) ),
			'not hex'             => array( str_repeat( 'z', 64 ) ),
			'unknown valid shape' => array( str_repeat( 'a', 64 ) ),
		);
	}

	/**
	 * An expired refresh token is rejected.
	 */
	public function test_refresh_with_expired_token_is_rejected(): void {
		global $wpdb;

		$refresh_token = $this->refresh_token_from( $this->login() );

		$table = $wpdb->prefix . 'bp_tracker_refresh_tokens';
		$wpdb->update(
			$table,
			array( 'expires_at' => gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS ) ),
			array( 'token_hash' => hash( 'sha256', $refresh_token ) ),
			array( '%s' ),
			array( '%s' )
		);

		$this->send_refresh_cookie( $refresh_token );
		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh' );

		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * A refresh token whose user no longer exists is rejected.
	 */
	public function test_refresh_for_a_deleted_user_is_rejected(): void {
		$refresh_token = $this->refresh_token_from( $this->login() );
		require_once ABSPATH . 'wp-admin/includes/user.php';
		wp_delete_user( $this->user_id );

		$this->send_refresh_cookie( $refresh_token );
		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh' );

		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * Logout revokes the refresh token and clears the cookie, without needing
	 * an access token; the revoked token can't be refreshed afterwards.
	 */
	public function test_logout_revokes_the_cookie_token(): void {
		$refresh_token = $this->refresh_token_from( $this->login() );
		$this->assertSame( 1, $this->count_refresh_tokens() );

		$this->send_refresh_cookie( $refresh_token );
		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/logout' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['success'] );
		$this->assert_clears_refresh_cookie( $response );
		$this->assertSame( 0, $this->count_refresh_tokens() );

		$refresh = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh' );
		$this->assertSame( 401, $refresh->get_status() );
	}

	/**
	 * Logout without a cookie is a harmless no-op that still clears it.
	 */
	public function test_logout_without_cookie_succeeds(): void {
		$this->refresh_token_from( $this->login() );

		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/logout' );

		$this->assertSame( 200, $response->get_status() );
		$this->assert_clears_refresh_cookie( $response );
		$this->assertSame( 1, $this->count_refresh_tokens(), 'Other sessions are untouched.' );
	}

	/**
	 * A protected endpoint outside bp-tracker/v1/auth (bp-tracker/v1/readings,
	 * owned by BP_Tracker_REST_Controller) rejects requests without a Bearer
	 * token -- proves validate_token() authenticates any REST route, not
	 * just this class' own.
	 */
	public function test_protected_endpoint_rejects_without_token(): void {
		$response = $this->dispatch(
			'POST',
			'/bp-tracker/v1/readings',
			array(
				'reading_datetime' => '2026-09-22T08:30:00+00:00',
				'systolic'         => 120,
				'diastolic'        => 80,
			)
		);

		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * The same protected endpoint accepts requests carrying a valid Bearer token.
	 */
	public function test_protected_endpoint_accepts_with_valid_token(): void {
		$login = $this->login();
		$this->set_bearer_token( $login->get_data()['access_token'] );

		$response = $this->dispatch(
			'POST',
			'/bp-tracker/v1/readings',
			array(
				'reading_datetime' => '2026-09-22T08:30:00+00:00',
				'systolic'         => 120,
				'diastolic'        => 80,
			)
		);

		$this->assertSame( 201, $response->get_status() );
	}

	/**
	 * maybe_upgrade() (re)creates the table and stamps the version option
	 * when it's missing or stale — covers sites where the plugin was
	 * already active before this table was introduced.
	 */
	public function test_upgrade_creates_table_when_version_option_is_stale(): void {
		global $wpdb;

		delete_option( BP_Tracker_JWT_Auth::DB_VERSION_OPTION );

		BP_Tracker_JWT_Auth::maybe_upgrade();

		$this->assertSame( BP_Tracker_JWT_Auth::DB_VERSION, get_option( BP_Tracker_JWT_Auth::DB_VERSION_OPTION ) );

		$table = $wpdb->prefix . 'bp_tracker_refresh_tokens';
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is our own prefixed table name, never user input.
		$this->assertSame( $table, $wpdb->get_var( "SHOW TABLES LIKE '{$table}'" ) );
	}
}
