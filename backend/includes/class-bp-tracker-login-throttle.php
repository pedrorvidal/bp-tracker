<?php
/**
 * Brute-force protection for POST /auth/login.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_Login_Throttle
 *
 * Counts failed logins in fixed windows, in three buckets:
 *
 * - account + IP: the tight limit that stops ordinary brute force, without
 *   letting an attacker lock the real user out from everywhere;
 * - IP: stops one address from spraying many accounts;
 * - account (all IPs): a looser limit against distributed attacks.
 *
 * A login is refused while any bucket is at its limit, before the password
 * is checked, so a correct guess can't be confirmed during a lockout.
 * Counters live in transients, which expire with their window.
 */
class BP_Tracker_Login_Throttle {

	/**
	 * Length of a counting window, in seconds.
	 *
	 * @var int
	 */
	const WINDOW = 15 * MINUTE_IN_SECONDS;

	/**
	 * Failed attempts allowed per account from one IP, per window.
	 *
	 * @var int
	 */
	const MAX_PER_ACCOUNT_AND_IP = 5;

	/**
	 * Failed attempts allowed per IP (any account), per window.
	 *
	 * @var int
	 */
	const MAX_PER_IP = 20;

	/**
	 * Failed attempts allowed per account (any IP), per window.
	 *
	 * @var int
	 */
	const MAX_PER_ACCOUNT = 50;

	/**
	 * Transient name prefix.
	 *
	 * @var string
	 */
	const TRANSIENT_PREFIX = 'bp_tracker_login_';

	/**
	 * Seconds until a login attempt is allowed again; 0 when it is allowed now.
	 *
	 * @param string $username Username or email being logged into.
	 * @param string $ip       Client IP ('' when unknown).
	 * @return int
	 */
	public static function retry_after( string $username, string $ip ): int {
		$now  = time();
		$wait = 0;

		foreach ( self::buckets( $username, $ip ) as $key => $max ) {
			$state = self::read( $key );

			if ( null !== $state && $state['count'] >= $max && $state['reset_at'] > $now ) {
				$wait = max( $wait, $state['reset_at'] - $now );
			}
		}

		return $wait;
	}

	/**
	 * Records a failed login in every bucket.
	 *
	 * @param string $username Username or email that failed.
	 * @param string $ip       Client IP ('' when unknown).
	 */
	public static function record_failure( string $username, string $ip ): void {
		$now = time();

		foreach ( array_keys( self::buckets( $username, $ip ) ) as $key ) {
			$state = self::read( $key );

			if ( null === $state || $state['reset_at'] <= $now ) {
				$state = array(
					'count'    => 0,
					'reset_at' => $now + self::WINDOW,
				);
			}

			++$state['count'];
			set_transient( self::TRANSIENT_PREFIX . $key, $state, max( 1, $state['reset_at'] - $now ) );
		}
	}

	/**
	 * Clears the account's counters after a successful login.
	 *
	 * The IP counter is deliberately kept: otherwise an attacker could reset
	 * it by logging into an account of their own between guesses.
	 *
	 * @param string $username Username or email that logged in.
	 * @param string $ip       Client IP ('' when unknown).
	 */
	public static function clear_account( string $username, string $ip ): void {
		$account = self::account_id( $username );

		delete_transient( self::TRANSIENT_PREFIX . self::key( 'account', $account ) );

		if ( '' !== $ip ) {
			delete_transient( self::TRANSIENT_PREFIX . self::key( 'account_ip', $account . '|' . $ip ) );
		}
	}

	/**
	 * The client IP: REMOTE_ADDR, which can't be spoofed by the client.
	 *
	 * Behind a reverse proxy REMOTE_ADDR is the proxy's address; use the
	 * "bp_tracker_client_ip" filter to read the real client IP from a header
	 * the proxy sets, and only then.
	 *
	 * @return string A valid IP address, or '' when unknown.
	 */
	public static function client_ip(): string {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';

		/**
		 * Filters the client IP used for login rate limiting.
		 *
		 * @param string $ip REMOTE_ADDR, or '' when unavailable.
		 */
		$ip = (string) apply_filters( 'bp_tracker_client_ip', $ip );

		return false === filter_var( $ip, FILTER_VALIDATE_IP ) ? '' : $ip;
	}

	/**
	 * Buckets that apply to an attempt, as key => limit.
	 *
	 * @param string $username Username or email.
	 * @param string $ip       Client IP ('' when unknown).
	 * @return array<string, int>
	 */
	private static function buckets( string $username, string $ip ): array {
		$account = self::account_id( $username );
		$buckets = array( self::key( 'account', $account ) => self::MAX_PER_ACCOUNT );

		if ( '' !== $ip ) {
			$buckets[ self::key( 'account_ip', $account . '|' . $ip ) ] = self::MAX_PER_ACCOUNT_AND_IP;
			$buckets[ self::key( 'ip', $ip ) ]                          = self::MAX_PER_IP;
		}

		return $buckets;
	}

	/**
	 * Identifies the account an attempt targets.
	 *
	 * The login name and email of one user map to the same ID, so switching
	 * between them doesn't double the allowed attempts. Unknown names are
	 * counted too (by their normalized text), so responses don't reveal
	 * which accounts exist.
	 *
	 * @param string $username Username or email.
	 * @return string
	 */
	private static function account_id( string $username ): string {
		$username = strtolower( trim( $username ) );
		$user     = get_user_by( 'login', $username );

		if ( false === $user && is_email( $username ) ) {
			$user = get_user_by( 'email', $username );
		}

		return false === $user ? 'name:' . $username : 'user:' . $user->ID;
	}

	/**
	 * Builds a bucket key short enough for a transient name.
	 *
	 * @param string $type  Bucket type.
	 * @param string $value Value identifying the bucket.
	 * @return string
	 */
	private static function key( string $type, string $value ): string {
		return $type . '_' . substr( hash( 'sha256', $value ), 0, 32 );
	}

	/**
	 * Reads a bucket's state.
	 *
	 * @param string $key Bucket key.
	 * @return array{count: int, reset_at: int}|null
	 */
	private static function read( string $key ): ?array {
		$state = get_transient( self::TRANSIENT_PREFIX . $key );

		if ( ! is_array( $state ) || ! isset( $state['count'], $state['reset_at'] ) ) {
			return null;
		}

		return array(
			'count'    => (int) $state['count'],
			'reset_at' => (int) $state['reset_at'],
		);
	}
}
