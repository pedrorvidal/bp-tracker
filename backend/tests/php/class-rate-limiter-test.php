<?php
/**
 * Tests for BP_Tracker_Rate_Limiter and its use in POST /auth/login.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_Rate_Limiter_Test
 */
class BP_Tracker_Rate_Limiter_Test extends WP_UnitTestCase {

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
		unset( $_SERVER['REMOTE_ADDR'], $_SERVER['HTTP_X_FORWARDED_FOR'] );

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

		$names = $wpdb->get_col( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_bp\\_tracker\\_rl\\_login%'" );
		$this->assertNotEmpty( $names );

		foreach ( $names as $option_name ) {
			$transient         = substr( (string) $option_name, strlen( '_transient_' ) );
			$state             = get_transient( $transient );
			$state['reset_at'] = time() - 1;
			set_transient( $transient, $state, 60 );
		}
	}

	/**
	 * After 5 failures from one IP the 6th attempt is refused with 429 and
	 * Retry-After, even with the correct password.
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
		$this->assertLessThanOrEqual( BP_Tracker_Rate_Limiter::LOGIN_WINDOW, $data['data']['retry_after'] );
		$this->assertSame( (string) $data['data']['retry_after'], $headers['Retry-After'] );
		$this->assertArrayNotHasKey( 'Set-Cookie', $headers, 'No session is issued while locked.' );
	}

	/**
	 * Four failures still allow a correct login, which resets the counters:
	 * a full budget of 5 failures is available again afterwards.
	 */
	public function test_success_below_the_limit_resets_the_counter(): void {
		$this->fail_login( 4 );
		$this->assertSame( 200, $this->attempt( 'victim', $this->password )->get_status() );

		$this->fail_login( 5 );
		$this->assertSame( 429, $this->attempt( 'victim', $this->password )->get_status() );
	}

	/**
	 * Successful logins are never counted.
	 */
	public function test_successful_logins_are_not_counted(): void {
		for ( $i = 0; $i < 10; $i++ ) {
			$this->assertSame( 200, $this->attempt( 'victim', $this->password )->get_status() );
		}
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
	 * The limit is per IP: 5 failures across any accounts block that IP for
	 * every account, and no other IP is affected.
	 */
	public function test_limit_is_per_ip(): void {
		for ( $i = 0; $i < 5; $i++ ) {
			$this->fail_login( 1, "someone-{$i}" );
		}

		$this->assertSame( 429, $this->attempt( 'victim', $this->password )->get_status() );
		$this->assertSame( 429, $this->attempt( 'attacker', $this->password )->get_status() );
		$this->assertSame( 200, $this->attempt( 'victim', $this->password, '198.51.100.7' )->get_status() );
		$this->assertSame( 403, $this->attempt( 'someone-0', 'wrong', '198.51.100.7' )->get_status() );
	}

	/**
	 * Logging into your own account resets your IP's counter, but not your
	 * failures against someone else's account: an attacker with an account
	 * still gets only 5 guesses per victim per window.
	 */
	public function test_own_successful_login_does_not_reset_another_accounts_counter(): void {
		$this->fail_login( 4, 'victim' );
		$this->assertSame( 200, $this->attempt( 'attacker', $this->password )->get_status() );

		$this->fail_login( 1, 'victim' );

		$this->assertSame( 429, $this->attempt( 'victim', $this->password )->get_status() );
		$this->assertSame( 403, $this->attempt( 'someone-else', 'wrong' )->get_status(), 'The IP itself was reset.' );
	}

	/**
	 * A pending account's correct password doesn't clear anything: signing
	 * up must not be a way to reset the counters.
	 */
	public function test_pending_login_does_not_reset_the_counter(): void {
		self::factory()->user->create(
			array(
				'user_login' => 'pending-person',
				'user_pass'  => $this->password,
				'role'       => BP_Tracker_Roles::PENDING,
			)
		);

		$this->fail_login( 4, 'someone' );
		$this->assertSame( 403, $this->attempt( 'pending-person', $this->password )->get_status() );
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
	 * Counters live in transients named after an HMAC of the IP, never the
	 * IP itself.
	 */
	public function test_transient_key_hashes_the_ip(): void {
		$key = BP_Tracker_Rate_Limiter::transient_name( 'login', '203.0.113.10' );

		$this->assertMatchesRegularExpression( '/^bp_tracker_rl_login_[0-9a-f]{32}$/', $key );
		$this->assertStringNotContainsString( '203.0.113.10', $key );
		$this->assertNotSame( $key, BP_Tracker_Rate_Limiter::transient_name( 'login', '203.0.113.11' ) );
		$this->assertNotSame( $key, BP_Tracker_Rate_Limiter::transient_name( 'register', '203.0.113.10' ) );

		$this->fail_login( 1 );
		$this->assertSame( 1, get_transient( $key )['count'] );
	}

	/**
	 * The client IP comes from REMOTE_ADDR, is validated, and can be
	 * overridden with a filter.
	 */
	public function test_client_ip(): void {
		$_SERVER['REMOTE_ADDR'] = '203.0.113.10';
		$this->assertSame( '203.0.113.10', BP_Tracker_Rate_Limiter::client_ip() );

		$_SERVER['REMOTE_ADDR'] = 'not-an-ip';
		$this->assertSame( '', BP_Tracker_Rate_Limiter::client_ip() );

		$_SERVER['REMOTE_ADDR'] = '2001:db8::1';
		$this->assertSame( '2001:db8::1', BP_Tracker_Rate_Limiter::client_ip() );

		add_filter( 'bp_tracker_client_ip', static fn() => '198.51.100.7' );
		$this->assertSame( '198.51.100.7', BP_Tracker_Rate_Limiter::client_ip() );
	}

	/**
	 * Without trusted proxies, X-Forwarded-For is ignored: otherwise a
	 * client could pick a fresh IP for every attempt.
	 */
	public function test_forwarded_for_is_ignored_by_default(): void {
		$_SERVER['REMOTE_ADDR']          = '203.0.113.10';
		$_SERVER['HTTP_X_FORWARDED_FOR'] = '198.51.100.7';

		$this->assertSame( array(), BP_Tracker_Rate_Limiter::trusted_proxies() );
		$this->assertSame( '203.0.113.10', BP_Tracker_Rate_Limiter::client_ip() );

		// Rotating the header doesn't escape the limit.
		for ( $i = 0; $i < 5; $i++ ) {
			$_SERVER['HTTP_X_FORWARDED_FOR'] = "192.0.2.{$i}";
			$this->fail_login( 1, 'victim', '203.0.113.10' );
		}
		$_SERVER['HTTP_X_FORWARDED_FOR'] = '192.0.2.99';
		$this->assertSame( 429, $this->attempt( 'victim', $this->password )->get_status() );
	}

	/**
	 * Behind a trusted proxy the client comes from X-Forwarded-For, and the
	 * limit follows the real client, not the proxy.
	 */
	public function test_forwarded_for_from_a_trusted_proxy(): void {
		add_filter( 'bp_tracker_trusted_proxies', static fn() => array( '10.0.0.0/8' ) );
		$_SERVER['REMOTE_ADDR'] = '10.1.2.3';

		$_SERVER['HTTP_X_FORWARDED_FOR'] = '198.51.100.7';
		$this->assertSame( '198.51.100.7', BP_Tracker_Rate_Limiter::client_ip() );

		$this->fail_login( 5, 'victim', '10.1.2.3' );
		$this->assertSame( 429, $this->attempt( 'victim', $this->password, '10.1.2.3' )->get_status() );

		// Another client behind the same proxy is not affected.
		$_SERVER['HTTP_X_FORWARDED_FOR'] = '198.51.100.8';
		$this->assertSame( 200, $this->attempt( 'victim', $this->password, '10.1.2.3' )->get_status() );
	}

	/**
	 * Resolution rules: the right-most untrusted hop wins; anything a client
	 * prepended is ignored; garbage stops the walk.
	 *
	 * @dataProvider data_resolve_client_ip
	 *
	 * @param string   $remote_addr REMOTE_ADDR.
	 * @param string   $forwarded   X-Forwarded-For.
	 * @param string[] $trusted     Trusted proxies.
	 * @param string   $expected    Expected client IP.
	 */
	public function test_resolve_client_ip( string $remote_addr, string $forwarded, array $trusted, string $expected ): void {
		$this->assertSame( $expected, BP_Tracker_Rate_Limiter::resolve_client_ip( $remote_addr, $forwarded, $trusted ) );
	}

	/**
	 * Cases for test_resolve_client_ip().
	 *
	 * @return array<string, array{string, string, string[], string}>
	 */
	public static function data_resolve_client_ip(): array {
		$proxies = array( '10.0.0.0/8', '2001:db8:ffff::/48' );

		return array(
			'direct, no header'              => array( '203.0.113.10', '', $proxies, '203.0.113.10' ),
			'untrusted peer, header ignored' => array( '203.0.113.10', '198.51.100.7', $proxies, '203.0.113.10' ),
			'trusted peer, no header'        => array( '10.0.0.1', '', $proxies, '10.0.0.1' ),
			'trusted peer, one hop'          => array( '10.0.0.1', '198.51.100.7', $proxies, '198.51.100.7' ),
			'spoofed entry prepended'        => array( '10.0.0.1', '1.2.3.4, 198.51.100.7', $proxies, '198.51.100.7' ),
			'chain of trusted proxies'       => array( '10.0.0.1', '198.51.100.7, 10.0.0.2', $proxies, '198.51.100.7' ),
			'all hops trusted'               => array( '10.0.0.1', '10.0.0.3, 10.0.0.2', $proxies, '10.0.0.3' ),
			'garbage hop'                    => array( '10.0.0.1', 'garbage', $proxies, '10.0.0.1' ),
			'garbage behind a trusted hop'   => array( '10.0.0.1', 'garbage, 10.0.0.2', $proxies, '10.0.0.2' ),
			'IPv6 proxy'                     => array( '2001:db8:ffff::1', '2001:db8:1::7', $proxies, '2001:db8:1::7' ),
			'invalid REMOTE_ADDR'            => array( 'nope', '198.51.100.7', $proxies, '' ),
			'no trusted proxies configured'  => array( '10.0.0.1', '198.51.100.7', array(), '10.0.0.1' ),
		);
	}

	/**
	 * CIDR matching for IPv4 and IPv6, including partial-byte prefixes.
	 */
	public function test_ip_in_range(): void {
		$this->assertTrue( BP_Tracker_Rate_Limiter::ip_in_range( '10.1.2.3', '10.0.0.0/8' ) );
		$this->assertFalse( BP_Tracker_Rate_Limiter::ip_in_range( '11.1.2.3', '10.0.0.0/8' ) );
		$this->assertTrue( BP_Tracker_Rate_Limiter::ip_in_range( '172.31.255.255', '172.16.0.0/12' ) );
		$this->assertFalse( BP_Tracker_Rate_Limiter::ip_in_range( '172.32.0.0', '172.16.0.0/12' ) );
		$this->assertTrue( BP_Tracker_Rate_Limiter::ip_in_range( '203.0.113.10', '203.0.113.10' ) );
		$this->assertFalse( BP_Tracker_Rate_Limiter::ip_in_range( '203.0.113.11', '203.0.113.10' ) );
		$this->assertTrue( BP_Tracker_Rate_Limiter::ip_in_range( '1.2.3.4', '0.0.0.0/0' ) );
		$this->assertTrue( BP_Tracker_Rate_Limiter::ip_in_range( '2001:db8::1', '2001:db8::/32' ) );
		$this->assertFalse( BP_Tracker_Rate_Limiter::ip_in_range( '2001:db9::1', '2001:db8::/32' ) );
		$this->assertFalse( BP_Tracker_Rate_Limiter::ip_in_range( '10.0.0.1', '::/0' ), 'IPv4 never matches an IPv6 range.' );
		$this->assertFalse( BP_Tracker_Rate_Limiter::ip_in_range( '10.0.0.1', '10.0.0.0/33' ) );
		$this->assertFalse( BP_Tracker_Rate_Limiter::ip_in_range( '10.0.0.1', '10.0.0.0/x' ) );
		$this->assertFalse( BP_Tracker_Rate_Limiter::ip_in_range( '10.0.0.1', 'not-a-range' ) );
	}

	/**
	 * Trusted proxies are read from BP_TRACKER_TRUSTED_PROXIES-style lists.
	 */
	public function test_trusted_proxies_from_the_filter(): void {
		add_filter( 'bp_tracker_trusted_proxies', static fn() => array( '10.0.0.0/8', '192.0.2.1' ) );

		$this->assertSame( array( '10.0.0.0/8', '192.0.2.1' ), BP_Tracker_Rate_Limiter::trusted_proxies() );
	}
}
