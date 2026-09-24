<?php
/**
 * Public sign-up: creates accounts that wait for approval.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_Registration
 *
 * POST /bp-tracker/v1/auth/register creates a user with the pending role and
 * issues no token: the account can't log in (or do anything else) until an
 * administrator approves it by giving it the bp_tracker_user role.
 */
class BP_Tracker_Registration {

	/**
	 * Minimum password length.
	 *
	 * @var int
	 */
	const PASSWORD_MIN_LENGTH = 8;

	/**
	 * Maximum password length (bounds the hashing cost of a request).
	 *
	 * @var int
	 */
	const PASSWORD_MAX_LENGTH = 256;

	/**
	 * Registration attempts allowed per client IP within WINDOW.
	 *
	 * Counts every attempt, successful or not: it bounds both mass sign-ups
	 * and probing which usernames/emails are taken.
	 *
	 * @var int
	 */
	const MAX_PER_IP = 10;

	/**
	 * Length of the rate limit window, in seconds.
	 *
	 * @var int
	 */
	const WINDOW = HOUR_IN_SECONDS;

	/**
	 * Transient prefix for the per-IP attempt counters.
	 *
	 * @var string
	 */
	const TRANSIENT_PREFIX = 'bp_tracker_register_';

	/**
	 * Wires up the route.
	 */
	public static function init(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Registers POST /auth/register.
	 *
	 * Public (no login), but like every auth route it requires the CSRF
	 * header, which only the configured frontend can send from a browser.
	 */
	public static function register_routes(): void {
		register_rest_route(
			BP_Tracker_JWT_Auth::REST_NAMESPACE,
			'/auth/register',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'handle_register' ),
				'permission_callback' => array( BP_Tracker_JWT_Auth::class, 'require_csrf_header' ),
				'args'                => array(
					'username' => array(
						'required' => true,
						'type'     => 'string',
					),
					'email'    => array(
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
	}

	/**
	 * Handles POST /auth/register.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function handle_register( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$retry_after = self::retry_after( BP_Tracker_Login_Throttle::client_ip() );

		if ( $retry_after > 0 ) {
			return new WP_Error(
				'bp_tracker_register_too_many_attempts',
				__( 'Too many registration attempts. Try again later.', 'bp-tracker' ),
				array(
					'status'      => 429,
					'retry_after' => $retry_after,
				)
			);
		}

		self::record_attempt( BP_Tracker_Login_Throttle::client_ip() );

		$username = (string) $request->get_param( 'username' );
		$email    = trim( (string) $request->get_param( 'email' ) );
		$password = (string) $request->get_param( 'password' );

		$error = self::validate( $username, $email, $password );

		if ( null !== $error ) {
			return $error;
		}

		$user_id = wp_insert_user(
			array(
				'user_login' => $username,
				'user_email' => $email,
				'user_pass'  => $password,
				'role'       => BP_Tracker_Roles::PENDING,
			)
		);

		if ( is_wp_error( $user_id ) ) {
			return new WP_Error(
				'bp_tracker_register_failed',
				__( 'Could not create the account.', 'bp-tracker' ),
				array( 'status' => 500 )
			);
		}

		/**
		 * Fires after an account is created and is waiting for approval.
		 * Hook in to notify the administrators.
		 *
		 * @param int $user_id The new user's ID.
		 */
		do_action( 'bp_tracker_user_registered', $user_id );

		return new WP_REST_Response(
			array( 'message' => __( 'Registration received. Your account is pending approval.', 'bp-tracker' ) ),
			201
		);
	}

	/**
	 * Validates the sign-up fields.
	 *
	 * @param string $username Requested username.
	 * @param string $email    Email address.
	 * @param string $password Plaintext password.
	 * @return WP_Error|null The first problem found, or null when valid.
	 */
	private static function validate( string $username, string $email, string $password ): ?WP_Error {
		// Reject rather than silently rewrite: the user must log in with
		// exactly the name they chose.
		if ( '' === $username || sanitize_user( $username, true ) !== $username || ! validate_username( $username ) || mb_strlen( $username ) > 60 ) {
			return self::invalid( 'bp_tracker_register_invalid_username', __( 'Usernames may only contain letters, numbers, spaces and . _ - @ (up to 60 characters).', 'bp-tracker' ) );
		}

		if ( ! is_email( $email ) || sanitize_email( $email ) !== $email ) {
			return self::invalid( 'bp_tracker_register_invalid_email', __( 'Enter a valid email address.', 'bp-tracker' ) );
		}

		if ( mb_strlen( $password ) < self::PASSWORD_MIN_LENGTH ) {
			/* translators: %d: minimum number of characters. */
			return self::invalid( 'bp_tracker_register_weak_password', sprintf( __( 'The password must be at least %d characters long.', 'bp-tracker' ), self::PASSWORD_MIN_LENGTH ) );
		}

		if ( mb_strlen( $password ) > self::PASSWORD_MAX_LENGTH ) {
			/* translators: %d: maximum number of characters. */
			return self::invalid( 'bp_tracker_register_long_password', sprintf( __( 'The password must be at most %d characters long.', 'bp-tracker' ), self::PASSWORD_MAX_LENGTH ) );
		}

		if ( false !== username_exists( $username ) ) {
			return new WP_Error( 'bp_tracker_register_username_exists', __( 'That username is already taken.', 'bp-tracker' ), array( 'status' => 409 ) );
		}

		if ( false !== email_exists( $email ) ) {
			return new WP_Error( 'bp_tracker_register_email_exists', __( 'That email address is already registered.', 'bp-tracker' ), array( 'status' => 409 ) );
		}

		return null;
	}

	/**
	 * Builds a 400 validation error.
	 *
	 * @param string $code    Error code.
	 * @param string $message Error message.
	 * @return WP_Error
	 */
	private static function invalid( string $code, string $message ): WP_Error {
		return new WP_Error( $code, $message, array( 'status' => 400 ) );
	}

	/**
	 * Seconds until the IP may try to register again; 0 when it may now.
	 *
	 * @param string $ip Client IP ('' when unknown: not limited).
	 * @return int
	 */
	private static function retry_after( string $ip ): int {
		$state = self::read( $ip );

		if ( null === $state || $state['count'] < self::MAX_PER_IP ) {
			return 0;
		}

		return max( 0, $state['reset_at'] - time() );
	}

	/**
	 * Counts a registration attempt from an IP.
	 *
	 * @param string $ip Client IP ('' when unknown: not counted).
	 */
	private static function record_attempt( string $ip ): void {
		if ( '' === $ip ) {
			return;
		}

		$now   = time();
		$state = self::read( $ip );

		if ( null === $state || $state['reset_at'] <= $now ) {
			$state = array(
				'count'    => 0,
				'reset_at' => $now + self::WINDOW,
			);
		}

		++$state['count'];
		set_transient( self::transient_name( $ip ), $state, max( 1, $state['reset_at'] - $now ) );
	}

	/**
	 * Reads an IP's attempt counter.
	 *
	 * @param string $ip Client IP.
	 * @return array{count: int, reset_at: int}|null
	 */
	private static function read( string $ip ): ?array {
		if ( '' === $ip ) {
			return null;
		}

		$state = get_transient( self::transient_name( $ip ) );

		if ( ! is_array( $state ) || ! isset( $state['count'], $state['reset_at'] ) ) {
			return null;
		}

		return array(
			'count'    => (int) $state['count'],
			'reset_at' => (int) $state['reset_at'],
		);
	}

	/**
	 * Transient name for an IP's counter.
	 *
	 * @param string $ip Client IP.
	 * @return string
	 */
	private static function transient_name( string $ip ): string {
		return self::TRANSIENT_PREFIX . substr( hash( 'sha256', $ip ), 0, 32 );
	}
}

BP_Tracker_Registration::init();
