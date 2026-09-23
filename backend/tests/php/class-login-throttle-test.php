<?php
/**
 * Tests for BP_Tracker_Login_Throttle and its use in POST /auth/login.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_Login_Throttle_Test
 */
class BP_Tracker_Login_Throttle_Test extends WP_UnitTestCase {

	/**
	 * Password of the test users.
	 *
	 * @var string
	 */
	private string $password = 'correct horse battery staple';

	/**
	 * Creates the victim and attacker accounts.
	 */
	public function setUp(): void {
		parent::setUp();

		self::factory()->user->create(
			array(
				'user_login' => 'victim',
				'user_email' => 'victim@example.com',
				'user_pass'  => $this->password,
			)
		);
		self::factory()->user->create(
			array(
				'user_login' => 'attacker',
				'user_pass'  => $this->password,
			)
		);
	}

	/**
	 * Clears the simulated client address.
	 */
	public function tearDown(): void {
		unset( $_SERVER['REMOTE_ADDR'] );

		parent::tearDown();
	}

	/**
	 * Attempts a login from an IP.
	 *
	 * @param string      $username Username or email.
	 * @param string      $password Password.
	 * @param string|null $ip       Client IP, or null for none.
	 * @return WP_REST_Response
	 */
	private function attempt( string $username, string $password, ?string $ip = '203.0.113.10' ): WP_REST_Response {
		if ( null === $ip ) {
			unset( $_SERVER['REMOTE_ADDR'] );
		} else {
			$_SERVER['REMOTE_ADDR'] = $ip;
		}

		$request = new WP_REST_Request( 'POST', '/bp-tracker/v1/auth/login' );
		$request->set_header( BP_Tracker_JWT_Auth::CSRF_HEADER, '1' );
		$request->set_param( 'username', $username );
		$request->set_param( 'password', $password );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Fails a login $times times.
	 *
	 * @param int         $times    Number of failures.
	 * @param string      $username Username or email.
	 * @param string|null $ip       Client IP.
	 */
	private function fail_login( int $times, string $username = 'victim', ?string $ip = '203.0.113.10' ): void {
		for ( $i = 0; $i < $times; $i++ ) {
			$this->assertSame( 403, $this->attempt( $username, 'wrong-' . $i, $ip )->get_status(), "Failure #{$i} should be a plain 403." );
		}
	}

	/**
	 * Moves every login counter's window into the past.
	 */
	private function expire_windows(): void {
		global $wpdb;

		$names = $wpdb->get_col( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_bp\\_tracker\\_login\\_%'" );
		$this->assertNotEmpty( $names );

		foreach ( $names as $option_name ) {
			$transient         = substr( (string) $option_name, strlen( '_transient_' ) );
			$state             = get_transient( $transient );
			$state['reset_at'] = time() - 1;
			set_transient( $transient, $state, 60 );
		}
	}

	/**
	 * After 5 failures from one IP the account is locked for that IP — even the
	 * correct password is refused, with 429 and Retry-After.
	 */
	public function test_locks_account_after_five_failures_from_one_ip(): void {
		$this->fail_login( 5 );

		$response = $this->attempt( 'victim', $this->password );
		$data     = $response->get_data();
		$headers  = $response->get_headers();

		$this->assertSame( 429, $response->get_status() );
		$this->assertSame( 'bp_tracker_jwt_too_many_attempts', $data['code'] );
		$this->assertArrayNotHasKey( 'access_token', $data );
		$this->assertGreaterThan( 0, $data['data']['retry_after'] );
		$this->assertLessThanOrEqual( BP_Tracker_Login_Throttle::WINDOW, $data['data']['retry_after'] );
		$this->assertSame( (string) $data['data']['retry_after'], $headers['Retry-After'] );
		$this->assertArrayNotHasKey( 'Set-Cookie', $headers, 'No session is issued while locked.' );
	}

	/**
	 * Four failures still allow a correct login, which resets the account's counter.
	 */
	public function test_success_below_the_limit_resets_the_account_counter(): void {
		$this->fail_login( 4 );
		$this->assertSame( 200, $this->attempt( 'victim', $this->password )->get_status() );

		// A fresh budget of 5: 4 more failures don't lock.
		$this->fail_login( 4 );
		$this->assertSame( 200, $this->attempt( 'victim', $this->password )->get_status() );
	}

	/**
	 * The tight lock is per account AND IP: an attacker can't lock the real
	 * user out from their own network.
	 */
	public function test_lock_does_not_block_the_account_from_another_ip(): void {
		$this->fail_login( 5, 'victim', '203.0.113.10' );

		$this->assertSame( 200, $this->attempt( 'victim', $this->password, '198.51.100.7' )->get_status() );
	}

	/**
	 * One IP spraying many accounts is blocked after 20 failures, for every account.
	 */
	public function test_blocks_an_ip_after_twenty_failures_across_accounts(): void {
		for ( $i = 0; $i < 20; $i++ ) {
			$this->fail_login( 1, "someone-{$i}" );
		}

		$this->assertSame( 429, $this->attempt( 'victim', $this->password )->get_status() );
		$this->assertSame( 200, $this->attempt( 'victim', $this->password, '198.51.100.7' )->get_status() );
	}

	/**
	 * Logging into your own account doesn't reset your IP's counter.
	 */
	public function test_own_successful_login_does_not_reset_the_ip_counter(): void {
		for ( $i = 0; $i < 19; $i++ ) {
			$this->fail_login( 1, "someone-{$i}" );
		}
		$this->assertSame( 200, $this->attempt( 'attacker', $this->password )->get_status() );

		$this->fail_login( 1, 'someone-else' );

		$this->assertSame( 429, $this->attempt( 'victim', $this->password )->get_status() );
	}

	/**
	 * A distributed attack (5 failures from each of 10 IPs) locks the account everywhere.
	 */
	public function test_locks_an_account_after_fifty_failures_from_many_ips(): void {
		for ( $i = 1; $i <= 10; $i++ ) {
			$this->fail_login( 5, 'victim', "192.0.2.{$i}" );
		}

		$this->assertSame( 429, $this->attempt( 'victim', $this->password, '198.51.100.7' )->get_status() );
	}

	/**
	 * The login name and email of one account share their counters.
	 */
	public function test_login_name_and_email_share_the_counter(): void {
		$this->fail_login( 3, 'victim' );
		$this->fail_login( 2, 'VICTIM@example.com' );

		$this->assertSame( 429, $this->attempt( 'victim', $this->password )->get_status() );
	}

	/**
	 * Unknown usernames are throttled like real ones, so responses don't
	 * reveal which accounts exist.
	 */
	public function test_unknown_usernames_are_throttled_the_same(): void {
		$this->fail_login( 5, 'ghost' );

		$this->assertSame( 429, $this->attempt( 'ghost', 'anything' )->get_status() );
	}

	/**
	 * Once the window is over, logins are allowed again.
	 */
	public function test_lock_expires_with_the_window(): void {
		$this->fail_login( 5 );
		$this->assertSame( 429, $this->attempt( 'victim', $this->password )->get_status() );

		$this->expire_windows();

		$this->assertSame( 200, $this->attempt( 'victim', $this->password )->get_status() );
	}

	/**
	 * Failures during a lock don't extend it (the window is fixed).
	 */
	public function test_attempts_during_a_lock_do_not_extend_it(): void {
		$this->fail_login( 5 );
		$first = $this->attempt( 'victim', 'wrong' )->get_data()['data']['retry_after'];

		$this->attempt( 'victim', 'wrong' );
		$second = $this->attempt( 'victim', 'wrong' )->get_data()['data']['retry_after'];

		$this->assertLessThanOrEqual( $first, $second );
	}

	/**
	 * Without a usable client IP only the (looser) per-account limit applies.
	 */
	public function test_without_client_ip_only_the_account_limit_applies(): void {
		$this->fail_login( 5, 'victim', null );

		$this->assertSame( 200, $this->attempt( 'victim', $this->password, null )->get_status() );
	}

	/**
	 * The client IP comes from REMOTE_ADDR, is validated, and can be overridden
	 * (for trusted reverse proxies) with a filter.
	 */
	public function test_client_ip(): void {
		$_SERVER['REMOTE_ADDR'] = '203.0.113.10';
		$this->assertSame( '203.0.113.10', BP_Tracker_Login_Throttle::client_ip() );

		$_SERVER['REMOTE_ADDR'] = 'not-an-ip';
		$this->assertSame( '', BP_Tracker_Login_Throttle::client_ip() );

		$_SERVER['REMOTE_ADDR'] = '2001:db8::1';
		$this->assertSame( '2001:db8::1', BP_Tracker_Login_Throttle::client_ip() );

		add_filter( 'bp_tracker_client_ip', static fn() => '198.51.100.7' );
		$this->assertSame( '198.51.100.7', BP_Tracker_Login_Throttle::client_ip() );
	}
}
