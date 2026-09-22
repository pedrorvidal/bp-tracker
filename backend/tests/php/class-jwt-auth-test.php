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
		unset( $_SERVER['HTTP_AUTHORIZATION'] );
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
	 * @param string $method HTTP method.
	 * @param string $route  Route, including leading slash.
	 * @param array  $params Body params.
	 * @return WP_REST_Response
	 */
	private function dispatch( string $method, string $route, array $params = array() ): WP_REST_Response {
		$request = new WP_REST_Request( $method, $route );

		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * A valid login returns a usable access/refresh token pair.
	 */
	public function test_login_with_valid_credentials_returns_tokens(): void {
		$response = $this->dispatch(
			'POST',
			'/bp-tracker/v1/auth/login',
			array(
				'username' => 'bp-tracker-tester',
				'password' => $this->password,
			)
		);
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertArrayHasKey( 'access_token', $data );
		$this->assertArrayHasKey( 'refresh_token', $data );
		$this->assertSame( 'Bearer', $data['token_type'] );
		$this->assertSame( HOUR_IN_SECONDS, $data['expires_in'] );

		$decoded = JWT::decode( $data['access_token'], new Key( BP_TRACKER_JWT_SECRET, 'HS256' ) );

		$this->assertSame( $this->user_id, (int) $decoded->user_id );
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
	}

	/**
	 * A valid refresh token yields a new token pair and revokes itself.
	 */
	public function test_refresh_with_valid_token_rotates_it(): void {
		$login       = $this->dispatch(
			'POST',
			'/bp-tracker/v1/auth/login',
			array(
				'username' => 'bp-tracker-tester',
				'password' => $this->password,
			)
		);
		$old_refresh = $login->get_data()['refresh_token'];

		$refresh = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh', array( 'refresh_token' => $old_refresh ) );
		$data    = $refresh->get_data();

		$this->assertSame( 200, $refresh->get_status() );
		$this->assertArrayHasKey( 'access_token', $data );
		$this->assertArrayHasKey( 'refresh_token', $data );
		$this->assertNotSame( $old_refresh, $data['refresh_token'] );

		// The old refresh token was invalidated by rotation.
		$reuse = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh', array( 'refresh_token' => $old_refresh ) );
		$this->assertSame( 401, $reuse->get_status() );
	}

	/**
	 * An expired refresh token is rejected.
	 */
	public function test_refresh_with_expired_token_is_rejected(): void {
		global $wpdb;

		$login         = $this->dispatch(
			'POST',
			'/bp-tracker/v1/auth/login',
			array(
				'username' => 'bp-tracker-tester',
				'password' => $this->password,
			)
		);
		$refresh_token = $login->get_data()['refresh_token'];

		$table = $wpdb->prefix . 'bp_tracker_refresh_tokens';
		$wpdb->update(
			$table,
			array( 'expires_at' => gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS ) ),
			array( 'token_hash' => hash( 'sha256', $refresh_token ) ),
			array( '%s' ),
			array( '%s' )
		);

		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh', array( 'refresh_token' => $refresh_token ) );

		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * A revoked (deleted) refresh token is rejected.
	 */
	public function test_refresh_with_revoked_token_is_rejected(): void {
		$login         = $this->dispatch(
			'POST',
			'/bp-tracker/v1/auth/login',
			array(
				'username' => 'bp-tracker-tester',
				'password' => $this->password,
			)
		);
		$refresh_token = $login->get_data()['refresh_token'];

		$this->set_bearer_token( $login->get_data()['access_token'] );
		$logout = $this->dispatch( 'POST', '/bp-tracker/v1/auth/logout', array( 'refresh_token' => $refresh_token ) );
		$this->assertSame( 200, $logout->get_status() );

		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/refresh', array( 'refresh_token' => $refresh_token ) );

		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * Logout deletes only the current user's matching refresh token row.
	 */
	public function test_logout_revokes_the_token(): void {
		global $wpdb;

		$login         = $this->dispatch(
			'POST',
			'/bp-tracker/v1/auth/login',
			array(
				'username' => 'bp-tracker-tester',
				'password' => $this->password,
			)
		);
		$refresh_token = $login->get_data()['refresh_token'];
		$table         = $wpdb->prefix . 'bp_tracker_refresh_tokens';

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is our own prefixed table name, never user input.
		$this->assertSame( 1, (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" ) );

		$this->set_bearer_token( $login->get_data()['access_token'] );
		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/logout', array( 'refresh_token' => $refresh_token ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['success'] );
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is our own prefixed table name, never user input.
		$this->assertSame( 0, (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" ) );
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
		$login = $this->dispatch(
			'POST',
			'/bp-tracker/v1/auth/login',
			array(
				'username' => 'bp-tracker-tester',
				'password' => $this->password,
			)
		);
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
