<?php
/**
 * Tests for BP_Tracker_Registration and the approval gate at login.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_Registration_Test
 */
class BP_Tracker_Registration_Test extends WP_UnitTestCase {

	/**
	 * A valid password for the accounts created here.
	 *
	 * @var string
	 */
	private string $password = 'correct horse battery staple';

	/**
	 * Clears request state left over by a test.
	 */
	public function tearDown(): void {
		unset( $_SERVER['REMOTE_ADDR'], $_COOKIE[ BP_Tracker_JWT_Auth::REFRESH_COOKIE ] );
		wp_set_current_user( 0 );

		parent::tearDown();
	}

	/**
	 * Dispatches a REST request with body params.
	 *
	 * @param string               $route  Route, including leading slash.
	 * @param array<string, mixed> $params Body params.
	 * @param bool                 $csrf   Whether to send the CSRF header.
	 * @return WP_REST_Response
	 */
	private function post( string $route, array $params = array(), bool $csrf = true ): WP_REST_Response {
		$request = new WP_REST_Request( 'POST', $route );

		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		if ( $csrf ) {
			$request->set_header( BP_Tracker_JWT_Auth::CSRF_HEADER, '1' );
		}

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Calls POST /auth/register, with valid defaults for missing fields.
	 *
	 * @param array<string, string> $overrides Field overrides.
	 * @return WP_REST_Response
	 */
	private function register( array $overrides = array() ): WP_REST_Response {
		return $this->post(
			'/bp-tracker/v1/auth/register',
			array_merge(
				array(
					'username' => 'new-person',
					'email'    => 'new-person@example.com',
					'password' => $this->password,
				),
				$overrides
			)
		);
	}

	/**
	 * Calls POST /auth/login.
	 *
	 * @param string $username Username.
	 * @param string $password Password.
	 * @return WP_REST_Response
	 */
	private function login( string $username, string $password ): WP_REST_Response {
		return $this->post(
			'/bp-tracker/v1/auth/login',
			array(
				'username' => $username,
				'password' => $password,
			)
		);
	}

	/**
	 * Asserts a response is an error with a given status and code.
	 *
	 * @param int              $status   Expected HTTP status.
	 * @param string           $code     Expected error code.
	 * @param WP_REST_Response $response Response.
	 */
	private function assertError( int $status, string $code, WP_REST_Response $response ): void {
		$this->assertSame( $status, $response->get_status() );
		$this->assertSame( $code, $response->as_error()->get_error_code() );
	}

	/**
	 * Registering creates a pending user and issues no token or cookie.
	 */
	public function test_register_creates_a_pending_user(): void {
		$response = $this->register();

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame(
			array( 'message' => 'Registration received. Your account is pending approval.' ),
			$response->get_data()
		);
		$this->assertArrayNotHasKey( 'Set-Cookie', $response->get_headers() );

		$user = get_user_by( 'login', 'new-person' );
		$this->assertInstanceOf( WP_User::class, $user );
		$this->assertSame( 'new-person@example.com', $user->user_email );
		$this->assertSame( array( BP_Tracker_Roles::PENDING ), array_values( $user->roles ) );
		$this->assertTrue( wp_check_password( $this->password, $user->user_pass, $user->ID ) );
		$this->assertFalse( user_can( $user, 'edit_bp_readings' ) );
	}

	/**
	 * Registration announces the new account for notification hooks.
	 */
	public function test_register_fires_the_registered_action(): void {
		$registered = array();
		$listener   = static function ( int $user_id ) use ( &$registered ): void {
			$registered[] = $user_id;
		};
		add_action( 'bp_tracker_user_registered', $listener );

		$this->register();
		remove_action( 'bp_tracker_user_registered', $listener );

		$this->assertSame( array( get_user_by( 'login', 'new-person' )->ID ), $registered );
	}

	/**
	 * A taken username is rejected, and no account is created.
	 */
	public function test_duplicate_username_is_rejected(): void {
		self::factory()->user->create( array( 'user_login' => 'new-person' ) );
		$users_before = count_users()['total_users'];

		$this->assertError( 409, 'bp_tracker_register_username_exists', $this->register( array( 'email' => 'someone-else@example.com' ) ) );
		$this->assertSame( $users_before, count_users()['total_users'] );
	}

	/**
	 * A taken email is rejected, and no account is created.
	 */
	public function test_duplicate_email_is_rejected(): void {
		self::factory()->user->create( array( 'user_email' => 'new-person@example.com' ) );
		$users_before = count_users()['total_users'];

		$this->assertError( 409, 'bp_tracker_register_email_exists', $this->register( array( 'username' => 'someone-else' ) ) );
		$this->assertSame( $users_before, count_users()['total_users'] );
	}

	/**
	 * Passwords shorter than 8 characters are rejected; 8 is enough.
	 */
	public function test_short_password_is_rejected(): void {
		$this->assertError( 400, 'bp_tracker_register_weak_password', $this->register( array( 'password' => '1234567' ) ) );
		$this->assertFalse( get_user_by( 'login', 'new-person' ) );

		$this->assertSame( 201, $this->register( array( 'password' => '12345678' ) )->get_status() );
	}

	/**
	 * Absurdly long passwords are rejected (bounds the hashing cost).
	 */
	public function test_overlong_password_is_rejected(): void {
		$this->assertError( 400, 'bp_tracker_register_long_password', $this->register( array( 'password' => str_repeat( 'a', 257 ) ) ) );
	}

	/**
	 * Invalid emails are rejected.
	 *
	 * @dataProvider data_invalid_emails
	 *
	 * @param string $email Invalid email.
	 */
	public function test_invalid_email_is_rejected( string $email ): void {
		$this->assertError( 400, 'bp_tracker_register_invalid_email', $this->register( array( 'email' => $email ) ) );
	}

	/**
	 * Emails that must be rejected.
	 *
	 * @return array<string, array{string}>
	 */
	public static function data_invalid_emails(): array {
		return array(
			'empty'      => array( '' ),
			'no at'      => array( 'new-person.example.com' ),
			'no domain'  => array( 'new-person@' ),
			'with space' => array( 'new person@example.com' ),
		);
	}

	/**
	 * Usernames WordPress would silently rewrite (or refuse) are rejected.
	 *
	 * @dataProvider data_invalid_usernames
	 *
	 * @param string $username Invalid username.
	 */
	public function test_invalid_username_is_rejected( string $username ): void {
		$this->assertError( 400, 'bp_tracker_register_invalid_username', $this->register( array( 'username' => $username ) ) );
	}

	/**
	 * Usernames that must be rejected.
	 *
	 * @return array<string, array{string}>
	 */
	public static function data_invalid_usernames(): array {
		return array(
			'empty'      => array( '' ),
			'markup'     => array( '<b>bold</b>' ),
			'accents'    => array( 'joão' ),
			'too long'   => array( str_repeat( 'a', 61 ) ),
			'whitespace' => array( ' padded ' ),
		);
	}

	/**
	 * Like the other auth routes, registration requires the CSRF header.
	 */
	public function test_register_requires_the_csrf_header(): void {
		$response = $this->post(
			'/bp-tracker/v1/auth/register',
			array(
				'username' => 'new-person',
				'email'    => 'new-person@example.com',
				'password' => $this->password,
			),
			false
		);

		$this->assertError( 403, 'bp_tracker_jwt_missing_csrf_header', $response );
		$this->assertFalse( get_user_by( 'login', 'new-person' ) );
	}

	/**
	 * Registration attempts are limited per IP, successful or not.
	 */
	public function test_registration_is_rate_limited_per_ip(): void {
		$_SERVER['REMOTE_ADDR'] = '203.0.113.7';

		for ( $i = 0; $i < BP_Tracker_Registration::MAX_PER_IP; $i++ ) {
			$this->assertNotSame( 429, $this->register( array( 'password' => 'short' ) )->get_status() );
		}

		$blocked = $this->register();
		$this->assertError( 429, 'bp_tracker_register_too_many_attempts', $blocked );
		$this->assertGreaterThan( 0, $blocked->get_data()['data']['retry_after'] );
		$this->assertFalse( get_user_by( 'login', 'new-person' ) );

		// Another IP is not affected.
		$_SERVER['REMOTE_ADDR'] = '203.0.113.8';
		$this->assertSame( 201, $this->register()->get_status() );
	}

	/**
	 * A pending account can't log in: 403 and no token or cookie.
	 */
	public function test_login_of_pending_user_is_refused(): void {
		$this->register();

		$response = $this->login( 'new-person', $this->password );

		$this->assertError( 403, 'bp_tracker_jwt_account_pending', $response );
		$this->assertSame( 'Your account is pending approval.', $response->as_error()->get_error_message() );
		$this->assertArrayNotHasKey( 'access_token', (array) $response->get_data() );
		$this->assertArrayNotHasKey( 'Set-Cookie', $response->get_headers() );
	}

	/**
	 * The pending status is only revealed to someone with the password.
	 */
	public function test_wrong_password_for_pending_user_is_a_plain_failure(): void {
		$this->register();

		$this->assertError( 403, 'bp_tracker_jwt_invalid_credentials', $this->login( 'new-person', 'wrong password' ) );
	}

	/**
	 * An approved (bp_tracker_user) account logs in normally.
	 */
	public function test_login_of_bp_tracker_user_works(): void {
		$this->register();
		get_user_by( 'login', 'new-person' )->set_role( BP_Tracker_Roles::USER );

		$response = $this->login( 'new-person', $this->password );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNotEmpty( $response->get_data()['access_token'] );
		$this->assertArrayHasKey( 'Set-Cookie', $response->get_headers() );
	}

	/**
	 * A user made pending again can't refresh the session they had.
	 */
	public function test_user_demoted_to_pending_cannot_refresh(): void {
		$user_id = self::factory()->user->create(
			array(
				'user_login' => 'approved-person',
				'user_pass'  => $this->password,
				'role'       => BP_Tracker_Roles::USER,
			)
		);
		$login   = $this->login( 'approved-person', $this->password );
		$this->assertSame( 200, $login->get_status() );
		$token = (string) preg_replace( '/^[^=]+=([^;]*);.*$/', '$1', (string) $login->get_headers()['Set-Cookie'] );

		// Bypass the revocation hook to exercise the refresh backstop itself.
		remove_action( 'add_user_role', array( BP_Tracker_Roles::class, 'revoke_if_pending' ) );
		get_userdata( $user_id )->set_role( BP_Tracker_Roles::PENDING );
		add_action( 'add_user_role', array( BP_Tracker_Roles::class, 'revoke_if_pending' ), 10, 2 );

		$_COOKIE[ BP_Tracker_JWT_Auth::REFRESH_COOKIE ] = $token;
		$refresh                                        = $this->post( '/bp-tracker/v1/auth/refresh' );

		$this->assertSame( 401, $refresh->get_status() );
		$this->assertArrayNotHasKey( 'access_token', (array) $refresh->get_data() );
	}
}
