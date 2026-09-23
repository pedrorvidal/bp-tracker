<?php
/**
 * Tests for refresh token families and reuse detection.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_Refresh_Token_Reuse_Test
 */
class BP_Tracker_Refresh_Token_Reuse_Test extends WP_UnitTestCase {

	/**
	 * Test user.
	 *
	 * @var int
	 */
	private int $user_id;

	/**
	 * Password of the test user.
	 *
	 * @var string
	 */
	private string $password = 'correct horse battery staple';

	/**
	 * Creates the test user.
	 */
	public function setUp(): void {
		parent::setUp();

		$this->user_id = self::factory()->user->create(
			array(
				'user_login' => 'carol',
				'user_pass'  => $this->password,
			)
		);
	}

	/**
	 * Clears the simulated cookie.
	 */
	public function tearDown(): void {
		unset( $_COOKIE[ BP_Tracker_JWT_Auth::REFRESH_COOKIE ] );

		parent::tearDown();
	}

	/**
	 * Sends an auth request, optionally with a refresh cookie.
	 *
	 * @param string               $route  Route.
	 * @param string|null          $cookie Refresh token to send, or null.
	 * @param array<string, mixed> $params Params.
	 * @return WP_REST_Response
	 */
	private function auth( string $route, ?string $cookie = null, array $params = array() ): WP_REST_Response {
		unset( $_COOKIE[ BP_Tracker_JWT_Auth::REFRESH_COOKIE ] );
		if ( null !== $cookie ) {
			$_COOKIE[ BP_Tracker_JWT_Auth::REFRESH_COOKIE ] = $cookie;
		}

		$request = new WP_REST_Request( 'POST', '/bp-tracker/v1/auth/' . $route );
		$request->set_header( BP_Tracker_JWT_Auth::CSRF_HEADER, '1' );
		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Logs in (a new session / family) and returns the refresh token.
	 *
	 * @return string
	 */
	private function login(): string {
		return $this->token_from(
			$this->auth(
				'login',
				null,
				array(
					'username' => 'carol',
					'password' => $this->password,
				)
			)
		);
	}

	/**
	 * Refreshes with a token and returns the successor.
	 *
	 * @param string $token Refresh token.
	 * @return string
	 */
	private function rotate( string $token ): string {
		return $this->token_from( $this->auth( 'refresh', $token ) );
	}

	/**
	 * Extracts the refresh token a successful response set.
	 *
	 * @param WP_REST_Response $response Response.
	 * @return string
	 */
	private function token_from( WP_REST_Response $response ): string {
		$this->assertSame( 200, $response->get_status() );
		$header = (string) $response->get_headers()['Set-Cookie'];
		$this->assertMatchesRegularExpression( '/^bp_tracker_refresh=[0-9a-f]{64};/', $header );

		return (string) preg_replace( '/^[^=]+=([^;]*);.*$/', '$1', $header );
	}

	/**
	 * Reads a token's row.
	 *
	 * @param string $token Refresh token.
	 * @return object|null
	 */
	private function row( string $token ): ?object {
		global $wpdb;

		$table = BP_Tracker_JWT_Auth::table_name();

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is our own prefixed table name.
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE token_hash = %s", hash( 'sha256', $token ) ) );

		return is_object( $row ) ? $row : null;
	}

	/**
	 * Rotation keeps the family and marks the old token used instead of deleting it.
	 */
	public function test_rotation_keeps_the_family_and_marks_the_old_token_used(): void {
		$t1 = $this->login();
		$t2 = $this->rotate( $t1 );

		$this->assertMatchesRegularExpression( '/^[0-9a-f]{32}$/', $this->row( $t1 )->family_id );
		$this->assertSame( $this->row( $t1 )->family_id, $this->row( $t2 )->family_id );
		$this->assertNotNull( $this->row( $t1 )->used_at );
		$this->assertNull( $this->row( $t2 )->used_at );
	}

	/**
	 * Each login starts a new family.
	 */
	public function test_each_login_is_a_new_family(): void {
		$this->assertNotSame( $this->row( $this->login() )->family_id, $this->row( $this->login() )->family_id );
	}

	/**
	 * Replaying a used token revokes the whole family, including the
	 * successor the legitimate client holds.
	 */
	public function test_replaying_a_used_token_revokes_the_family(): void {
		$t1 = $this->login();
		$t2 = $this->rotate( $t1 );
		$t3 = $this->rotate( $t2 );

		$replay = $this->auth( 'refresh', $t1 );

		$this->assertSame( 401, $replay->get_status() );
		$this->assertStringContainsString( 'Max-Age=0', (string) $replay->get_headers()['Set-Cookie'] );
		$this->assertNull( $this->row( $t3 ), 'The current token of the family is revoked.' );
		$this->assertSame( 401, $this->auth( 'refresh', $t3 )->get_status() );
	}

	/**
	 * The attack reuse detection exists for: a thief rotates a stolen token
	 * first; when the real client later presents the (now used) original,
	 * the thief's successor is revoked.
	 */
	public function test_stolen_token_rotated_by_attacker_is_revoked_when_the_victim_returns(): void {
		$stolen        = $this->login();
		$attacker_next = $this->rotate( $stolen );

		// The victim still holds the original and uses it.
		$this->assertSame( 401, $this->auth( 'refresh', $stolen )->get_status() );

		// The attacker's copy is dead too.
		$this->assertSame( 401, $this->auth( 'refresh', $attacker_next )->get_status() );
	}

	/**
	 * Reuse revokes only that family: the user's other sessions keep working.
	 */
	public function test_reuse_does_not_touch_other_sessions(): void {
		$other_device = $this->login();
		$t1           = $this->login();
		$this->rotate( $t1 );

		$this->auth( 'refresh', $t1 );

		$this->assertSame( 200, $this->auth( 'refresh', $other_device )->get_status() );
	}

	/**
	 * Detection fires an action with the user and family, for logging/alerts.
	 */
	public function test_reuse_fires_an_action(): void {
		$t1     = $this->login();
		$family = $this->row( $t1 )->family_id;
		$this->rotate( $t1 );
		$seen = array();
		add_action(
			'bp_tracker_refresh_token_reuse_detected',
			static function ( int $user_id, string $family_id ) use ( &$seen ) {
				$seen[] = array( $user_id, $family_id );
			},
			10,
			2
		);

		$this->auth( 'refresh', $t1 );

		$this->assertSame( array( array( $this->user_id, $family ) ), $seen );
	}

	/**
	 * A normal refresh never fires the reuse action.
	 */
	public function test_normal_rotation_is_not_reuse(): void {
		$fired = false;
		add_action(
			'bp_tracker_refresh_token_reuse_detected',
			static function () use ( &$fired ) {
				$fired = true;
			}
		);

		$this->rotate( $this->rotate( $this->login() ) );

		$this->assertFalse( $fired );
	}

	/**
	 * Presenting a used token to logout-all is reuse too: nothing else is
	 * revoked on its authority, and its family is revoked.
	 */
	public function test_logout_all_with_a_used_token_is_reuse(): void {
		$other_device = $this->login();
		$t1           = $this->login();
		$t2           = $this->rotate( $t1 );

		$response = $this->auth( 'logout-all', $t1 );

		$this->assertSame( 401, $response->get_status() );
		$this->assertNull( $this->row( $t2 ) );
		$this->assertNotNull( $this->row( $other_device ), 'A stolen, used token cannot sign out other devices.' );
	}

	/**
	 * Logout ends the whole session: used tokens and the current one.
	 */
	public function test_logout_revokes_the_whole_family(): void {
		$other_device = $this->login();
		$t1           = $this->login();
		$t2           = $this->rotate( $t1 );

		$this->assertSame( 200, $this->auth( 'logout', $t2 )->get_status() );

		$this->assertNull( $this->row( $t1 ) );
		$this->assertNull( $this->row( $t2 ) );
		$this->assertNotNull( $this->row( $other_device ) );
	}

	/**
	 * Used tokens are purged once expired, like any other.
	 */
	public function test_purge_removes_expired_used_tokens(): void {
		global $wpdb;

		$t1 = $this->login();
		$t2 = $this->rotate( $t1 );
		$wpdb->update(
			BP_Tracker_JWT_Auth::table_name(),
			array( 'expires_at' => gmdate( 'Y-m-d H:i:s', time() - 1 ) ),
			array( 'token_hash' => hash( 'sha256', $t1 ) )
		);

		BP_Tracker_Sessions::purge_expired();

		$this->assertNull( $this->row( $t1 ) );
		$this->assertNotNull( $this->row( $t2 ) );
	}

	/**
	 * Upgrading from schema 1.0.0 gives each existing token its own family,
	 * so revoking one legacy session never touches another.
	 */
	public function test_upgrade_backfills_a_family_per_legacy_token(): void {
		global $wpdb;

		$table = BP_Tracker_JWT_Auth::table_name();
		$a     = $this->login();
		$b     = $this->login();
		$wpdb->query( "UPDATE {$table} SET family_id = ''" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery -- test setup on our own table.
		update_option( BP_Tracker_JWT_Auth::DB_VERSION_OPTION, '1.0.0' );

		BP_Tracker_JWT_Auth::maybe_upgrade();

		$family_a = $this->row( $a )->family_id;
		$family_b = $this->row( $b )->family_id;
		$this->assertMatchesRegularExpression( '/^[0-9a-f]{32}$/', $family_a );
		$this->assertNotSame( $family_a, $family_b );
		$this->assertSame( BP_Tracker_JWT_Auth::DB_VERSION, get_option( BP_Tracker_JWT_Auth::DB_VERSION_OPTION ) );

		// Legacy tokens keep working after the upgrade.
		$this->assertSame( 200, $this->auth( 'refresh', $a )->get_status() );
	}
}
