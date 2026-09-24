<?php
/**
 * Tests for BP_Tracker_Sessions and POST /auth/logout-all.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_Sessions_Test
 */
class BP_Tracker_Sessions_Test extends WP_UnitTestCase {

	/**
	 * The user whose sessions are revoked.
	 *
	 * @var int
	 */
	private int $user_id;

	/**
	 * Another user, whose sessions must never be affected.
	 *
	 * @var int
	 */
	private int $other_id;

	/**
	 * Password of both users.
	 *
	 * @var string
	 */
	private string $password = 'correct horse battery staple';

	/**
	 * Creates the two users.
	 */
	public function setUp(): void {
		parent::setUp();

		$this->user_id  = self::factory()->user->create(
			array(
				'user_login' => 'alice',
				'user_pass'  => $this->password,
				'role'       => BP_Tracker_Roles::USER,
			)
		);
		$this->other_id = self::factory()->user->create(
			array(
				'user_login' => 'bob',
				'user_pass'  => $this->password,
				'role'       => BP_Tracker_Roles::USER,
			)
		);
	}

	/**
	 * Clears simulated request state.
	 */
	public function tearDown(): void {
		unset( $_SERVER['HTTP_AUTHORIZATION'], $_COOKIE[ BP_Tracker_JWT_Auth::REFRESH_COOKIE ], $GLOBALS['current_user'] );
		wp_set_current_user( 0 );

		parent::tearDown();
	}

	/**
	 * Dispatches a request.
	 *
	 * @param string               $method Method.
	 * @param string               $route  Route.
	 * @param array<string, mixed> $params Params.
	 * @return WP_REST_Response
	 */
	private function dispatch( string $method, string $route, array $params = array() ): WP_REST_Response {
		$request = new WP_REST_Request( $method, $route );
		$request->set_header( BP_Tracker_JWT_Auth::CSRF_HEADER, '1' );

		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Logs a user in and returns [access token, refresh token].
	 *
	 * @param string $login Login name.
	 * @return array{0: string, 1: string}
	 */
	private function login( string $login ): array {
		$response = $this->dispatch(
			'POST',
			'/bp-tracker/v1/auth/login',
			array(
				'username' => $login,
				'password' => $this->password,
			)
		);
		$this->assertSame( 200, $response->get_status() );

		$cookie = (string) $response->get_headers()['Set-Cookie'];
		$this->assertMatchesRegularExpression( '/^bp_tracker_refresh=([0-9a-f]{64});/', $cookie );

		return array(
			$response->get_data()['access_token'],
			(string) preg_replace( '/^[^=]+=([^;]*);.*$/', '$1', $cookie ),
		);
	}

	/**
	 * Whether an access token is accepted, checked against GET /readings.
	 *
	 * @param string $access_token Access token.
	 * @return bool
	 */
	private function access_token_works( string $access_token ): bool {
		$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $access_token;
		unset( $GLOBALS['current_user'] );
		wp_set_current_user( 0 );
		// Re-run the determine_current_user pipeline for this "request".
		$user_id = (int) apply_filters( 'determine_current_user', false );
		wp_set_current_user( $user_id );

		$status = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/bp-tracker/v1/readings' ) )->get_status();

		unset( $_SERVER['HTTP_AUTHORIZATION'], $GLOBALS['current_user'] );
		wp_set_current_user( 0 );

		return 200 === $status;
	}

	/**
	 * Counts a user's refresh tokens.
	 *
	 * @param int $user_id User ID.
	 * @return int
	 */
	private function refresh_tokens_of( int $user_id ): int {
		global $wpdb;

		$table = BP_Tracker_JWT_Auth::table_name();

		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE user_id = %d', $table, $user_id ) );
	}

	/**
	 * revoke_all() deletes every refresh token of the user (and only theirs)
	 * and invalidates their access tokens immediately.
	 */
	public function test_revoke_all(): void {
		list( $access_a ) = $this->login( 'alice' );
		$this->login( 'alice' );
		list( $bob_access ) = $this->login( 'bob' );
		$this->assertTrue( $this->access_token_works( $access_a ) );

		$this->assertSame( 2, BP_Tracker_Sessions::revoke_all( $this->user_id ) );

		$this->assertSame( 0, $this->refresh_tokens_of( $this->user_id ) );
		$this->assertSame( 1, $this->refresh_tokens_of( $this->other_id ) );
		$this->assertFalse( $this->access_token_works( $access_a ), 'Unexpired access tokens stop working at once.' );
		$this->assertTrue( $this->access_token_works( $bob_access ) );
	}

	/**
	 * Tokens issued after a revocation work, even within the same second.
	 */
	public function test_new_login_after_revocation_works(): void {
		$this->login( 'alice' );
		BP_Tracker_Sessions::revoke_all( $this->user_id );

		list( $access ) = $this->login( 'alice' );

		$this->assertTrue( $this->access_token_works( $access ) );
	}

	/**
	 * Access tokens without a session generation (issued before it existed)
	 * are rejected, so clients fall back to refreshing.
	 */
	public function test_access_token_without_generation_is_rejected(): void {
		$legacy = \Firebase\JWT\JWT::encode(
			array(
				'iat'     => time(),
				'exp'     => time() + 600,
				'user_id' => $this->user_id,
			),
			BP_TRACKER_JWT_SECRET,
			'HS256'
		);

		$this->assertFalse( $this->access_token_works( $legacy ) );
	}

	/**
	 * A password reset (wp_set_password) signs the user out everywhere.
	 */
	public function test_password_reset_revokes_all_sessions(): void {
		list( $access ) = $this->login( 'alice' );

		wp_set_password( 'a brand new password', $this->user_id );

		$this->assertSame( 0, $this->refresh_tokens_of( $this->user_id ) );
		$this->assertFalse( $this->access_token_works( $access ) );
	}

	/**
	 * A password change through wp_update_user() (the profile screen) too.
	 */
	public function test_password_change_via_profile_revokes_all_sessions(): void {
		list( $access ) = $this->login( 'alice' );

		wp_update_user(
			array(
				'ID'        => $this->user_id,
				'user_pass' => 'a brand new password',
			)
		);

		$this->assertSame( 0, $this->refresh_tokens_of( $this->user_id ) );
		$this->assertFalse( $this->access_token_works( $access ) );
	}

	/**
	 * Older WordPress versions change the password in wp_update_user() without
	 * firing "wp_set_password"; the "profile_update" fallback must still revoke.
	 * Simulated by changing the hash directly and firing only profile_update.
	 */
	public function test_profile_update_fallback_revokes_on_password_change(): void {
		global $wpdb;

		list( $access ) = $this->login( 'alice' );
		$old_user_data  = get_userdata( $this->user_id );
		$this->assertInstanceOf( WP_User::class, $old_user_data );

		$wpdb->update( $wpdb->users, array( 'user_pass' => wp_hash_password( 'changed elsewhere' ) ), array( 'ID' => $this->user_id ) );
		clean_user_cache( $this->user_id );
		do_action( 'profile_update', $this->user_id, $old_user_data, array() );

		$this->assertSame( 0, $this->refresh_tokens_of( $this->user_id ) );
		$this->assertFalse( $this->access_token_works( $access ) );
	}

	/**
	 * Profile updates that don't touch the password keep the sessions.
	 */
	public function test_other_profile_updates_keep_sessions(): void {
		list( $access ) = $this->login( 'alice' );

		wp_update_user(
			array(
				'ID'           => $this->user_id,
				'display_name' => 'Alice A.',
			)
		);

		$this->assertSame( 1, $this->refresh_tokens_of( $this->user_id ) );
		$this->assertTrue( $this->access_token_works( $access ) );
	}

	/**
	 * POST /auth/logout-all signs the cookie's owner out of every device.
	 */
	public function test_logout_all_endpoint(): void {
		list( $access, $refresh ) = $this->login( 'alice' );
		$this->login( 'alice' );
		$this->login( 'bob' );

		$_COOKIE[ BP_Tracker_JWT_Auth::REFRESH_COOKIE ] = $refresh;
		$response                                       = $this->dispatch( 'POST', '/bp-tracker/v1/auth/logout-all' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				'success'          => true,
				'revoked_sessions' => 2,
			),
			$response->get_data()
		);
		$this->assertStringContainsString( 'Max-Age=0', (string) $response->get_headers()['Set-Cookie'] );
		$this->assertSame( 0, $this->refresh_tokens_of( $this->user_id ) );
		$this->assertSame( 1, $this->refresh_tokens_of( $this->other_id ) );
		$this->assertFalse( $this->access_token_works( $access ) );
	}

	/**
	 * Without a valid refresh cookie, logout-all is refused and revokes nothing.
	 */
	public function test_logout_all_requires_a_valid_cookie(): void {
		$this->login( 'alice' );

		$response = $this->dispatch( 'POST', '/bp-tracker/v1/auth/logout-all' );

		$this->assertSame( 401, $response->get_status() );
		$this->assertSame( 1, $this->refresh_tokens_of( $this->user_id ) );
	}

	/**
	 * Deleting a user deletes their refresh tokens.
	 */
	public function test_deleting_a_user_deletes_their_tokens(): void {
		$this->login( 'alice' );
		$this->login( 'bob' );
		require_once ABSPATH . 'wp-admin/includes/user.php';

		wp_delete_user( $this->user_id );

		$this->assertSame( 0, $this->refresh_tokens_of( $this->user_id ) );
		$this->assertSame( 1, $this->refresh_tokens_of( $this->other_id ) );
	}

	/**
	 * The daily purge deletes expired refresh tokens only.
	 */
	public function test_purge_deletes_only_expired_tokens(): void {
		global $wpdb;

		list( , $expired ) = $this->login( 'alice' );
		$this->login( 'alice' );
		$wpdb->update(
			BP_Tracker_JWT_Auth::table_name(),
			array( 'expires_at' => gmdate( 'Y-m-d H:i:s', time() - 1 ) ),
			array( 'token_hash' => hash( 'sha256', $expired ) )
		);

		do_action( BP_Tracker_Sessions::PURGE_HOOK );

		$this->assertSame( 1, $this->refresh_tokens_of( $this->user_id ) );
	}

	/**
	 * The purge is scheduled daily, once, and removed on deactivation.
	 */
	public function test_purge_scheduling(): void {
		BP_Tracker_Sessions::unschedule_purge();
		$this->assertFalse( wp_next_scheduled( BP_Tracker_Sessions::PURGE_HOOK ) );

		BP_Tracker_Sessions::schedule_purge();
		$first = wp_next_scheduled( BP_Tracker_Sessions::PURGE_HOOK );
		BP_Tracker_Sessions::schedule_purge();

		$this->assertIsInt( $first );
		$this->assertSame( $first, wp_next_scheduled( BP_Tracker_Sessions::PURGE_HOOK ), 'Scheduling is idempotent.' );
		$this->assertSame( 'daily', wp_get_schedule( BP_Tracker_Sessions::PURGE_HOOK ) );

		BP_Tracker_Sessions::unschedule_purge();
		$this->assertFalse( wp_next_scheduled( BP_Tracker_Sessions::PURGE_HOOK ) );
	}
}
