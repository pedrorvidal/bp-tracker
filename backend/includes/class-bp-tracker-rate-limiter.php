<?php
/**
 * Rate limiting for the public auth endpoints (login and register).
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_Rate_Limiter
 *
 * Fixed-window counters stored in transients (no table, no external
 * service). Each counter is a "bucket" with its own limit and window.
 *
 * POST /auth/login counts failed attempts, 15-minute windows:
 *
 * - IP: 5. The main limit against brute force from one address.
 * - account + IP: 5. Not cleared by someone else's successful login, so an
 *   attacker can't keep guessing one victim's password by logging into an
 *   account of their own to reset the IP counter.
 * - account (all IPs): 50. A looser limit against distributed attacks.
 *
 * A login is refused while any bucket is full, before the password is
 * checked, so a correct guess can't be confirmed during a lockout. A
 * successful login clears the IP bucket and that account's buckets.
 *
 * POST /auth/register counts every attempt, successful or not: 3 per IP per
 * hour. That bounds mass sign-ups and probing which usernames or emails are
 * taken.
 *
 * Bucket keys hold an HMAC of the IP/account, never the value itself.
 */
class BP_Tracker_Rate_Limiter {

	/**
	 * Length of a login counting window, in seconds.
	 *
	 * @var int
	 */
	const LOGIN_WINDOW = 15 * MINUTE_IN_SECONDS;

	/**
	 * Failed logins allowed per IP (any account), per window.
	 *
	 * @var int
	 */
	const LOGIN_MAX_PER_IP = 5;

	/**
	 * Failed logins allowed per account from one IP, per window.
	 *
	 * @var int
	 */
	const LOGIN_MAX_PER_ACCOUNT_AND_IP = 5;

	/**
	 * Failed logins allowed per account (any IP), per window.
	 *
	 * @var int
	 */
	const LOGIN_MAX_PER_ACCOUNT = 50;

	/**
	 * Length of a registration counting window, in seconds.
	 *
	 * @var int
	 */
	const REGISTER_WINDOW = HOUR_IN_SECONDS;

	/**
	 * Registration attempts allowed per IP, per window.
	 *
	 * @var int
	 */
	const REGISTER_MAX_PER_IP = 3;

	/**
	 * Transient name prefix.
	 *
	 * @var string
	 */
	const TRANSIENT_PREFIX = 'bp_tracker_rl_';

	/**
	 * Seconds until a login attempt is allowed again; 0 when it is allowed now.
	 *
	 * @param string $username Username or email being logged into.
	 * @param string $ip       Client IP ('' when unknown).
	 * @return int
	 */
	public static function login_retry_after( string $username, string $ip ): int {
		return self::retry_after( self::login_buckets( $username, $ip ) );
	}

	/**
	 * Records a failed login in every login bucket.
	 *
	 * @param string $username Username or email that failed.
	 * @param string $ip       Client IP ('' when unknown).
	 */
	public static function record_login_failure( string $username, string $ip ): void {
		self::hit( self::login_buckets( $username, $ip ) );
	}

	/**
	 * Clears the login counters after a successful login: the IP's and the
	 * account's. Other accounts' account + IP buckets are kept (see the
	 * class description).
	 *
	 * @param string $username Username or email that logged in.
	 * @param string $ip       Client IP ('' when unknown).
	 */
	public static function clear_login( string $username, string $ip ): void {
		foreach ( array_keys( self::login_buckets( $username, $ip ) ) as $key ) {
			delete_transient( $key );
		}
	}

	/**
	 * Seconds until the IP may try to register again; 0 when it may now.
	 *
	 * @param string $ip Client IP ('' when unknown: not limited).
	 * @return int
	 */
	public static function register_retry_after( string $ip ): int {
		return self::retry_after( self::register_buckets( $ip ) );
	}

	/**
	 * Counts a registration attempt from an IP.
	 *
	 * @param string $ip Client IP ('' when unknown: not counted).
	 */
	public static function record_register_attempt( string $ip ): void {
		self::hit( self::register_buckets( $ip ) );
	}

	/**
	 * Builds a 429 response with a Retry-After header.
	 *
	 * A WP_REST_Response rather than a WP_Error, because a WP_Error can't
	 * carry headers. The body has the usual error shape, and the wait is in
	 * it too: browsers don't expose Retry-After to cross-origin JavaScript
	 * unless it is CORS-exposed.
	 *
	 * @param string $code        Error code.
	 * @param string $message     Error message.
	 * @param int    $retry_after Seconds until the next attempt is allowed.
	 * @return WP_REST_Response
	 */
	public static function too_many_requests( string $code, string $message, int $retry_after ): WP_REST_Response {
		$response = new WP_REST_Response(
			array(
				'code'    => $code,
				'message' => $message,
				'data'    => array(
					'status'      => 429,
					'retry_after' => $retry_after,
				),
			),
			429
		);
		$response->header( 'Retry-After', (string) $retry_after );

		return $response;
	}

	/**
	 * The client IP.
	 *
	 * REMOTE_ADDR, unless it is a trusted proxy (BP_TRACKER_TRUSTED_PROXIES):
	 * then the client is read from X-Forwarded-For. The header is ignored
	 * otherwise, because any client can send one: trusting it by default
	 * would let an attacker pick a new IP for every attempt, or lock out
	 * someone else's.
	 *
	 * Hosting behind a proxy or CDN needs its addresses in
	 * BP_TRACKER_TRUSTED_PROXIES. A CDN that sends the client in another
	 * header (e.g. CF-Connecting-IP) needs the "bp_tracker_client_ip" filter.
	 *
	 * @return string A valid IP address, or '' when unknown.
	 */
	public static function client_ip(): string {
		$remote_addr = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$forwarded   = isset( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) : '';

		$ip = self::resolve_client_ip( $remote_addr, $forwarded, self::trusted_proxies() );

		/**
		 * Filters the client IP used for rate limiting.
		 *
		 * @param string $ip          The resolved client IP, or '' when unknown.
		 * @param string $remote_addr REMOTE_ADDR as received.
		 */
		$ip = (string) apply_filters( 'bp_tracker_client_ip', $ip, $remote_addr );

		return false === filter_var( $ip, FILTER_VALIDATE_IP ) ? '' : $ip;
	}

	/**
	 * Resolves the client IP from the connection and X-Forwarded-For.
	 *
	 * Walks X-Forwarded-For from the right (the entry our own proxy added)
	 * and returns the first address that isn't a trusted proxy. Entries
	 * further left were written by the client and can't be trusted.
	 *
	 * @param string   $remote_addr   REMOTE_ADDR.
	 * @param string   $forwarded_for X-Forwarded-For header ('' when absent).
	 * @param string[] $trusted       Trusted proxy IPs or CIDR ranges.
	 * @return string The client IP, or '' when REMOTE_ADDR is not an IP.
	 */
	public static function resolve_client_ip( string $remote_addr, string $forwarded_for, array $trusted ): string {
		if ( false === filter_var( $remote_addr, FILTER_VALIDATE_IP ) ) {
			return '';
		}

		if ( ! self::is_trusted( $remote_addr, $trusted ) || '' === trim( $forwarded_for ) ) {
			return $remote_addr;
		}

		$client = $remote_addr;

		foreach ( array_reverse( explode( ',', $forwarded_for ) ) as $hop ) {
			$hop = trim( $hop );

			// Garbage in the chain: stop at the last address we could verify.
			if ( false === filter_var( $hop, FILTER_VALIDATE_IP ) ) {
				return $client;
			}

			$client = $hop;

			if ( ! self::is_trusted( $hop, $trusted ) ) {
				return $hop;
			}
		}

		return $client;
	}

	/**
	 * Trusted proxies, from BP_TRACKER_TRUSTED_PROXIES (comma-separated IPs
	 * or CIDR ranges). None by default.
	 *
	 * @return string[]
	 */
	public static function trusted_proxies(): array {
		$configured = defined( 'BP_TRACKER_TRUSTED_PROXIES' ) ? constant( 'BP_TRACKER_TRUSTED_PROXIES' ) : '';
		$proxies    = is_string( $configured ) ? array_filter( array_map( 'trim', explode( ',', $configured ) ) ) : array();

		/**
		 * Filters the proxies whose X-Forwarded-For header is trusted.
		 *
		 * @param string[] $proxies IPs or CIDR ranges.
		 */
		return array_values( (array) apply_filters( 'bp_tracker_trusted_proxies', $proxies ) );
	}

	/**
	 * Whether an IP matches any trusted IP or CIDR range.
	 *
	 * @param string   $ip      IP address.
	 * @param string[] $trusted IPs or CIDR ranges.
	 * @return bool
	 */
	private static function is_trusted( string $ip, array $trusted ): bool {
		foreach ( $trusted as $range ) {
			if ( self::ip_in_range( $ip, (string) $range ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Whether an IP is a given address or inside a CIDR range (IPv4 or IPv6).
	 *
	 * @param string $ip    IP address.
	 * @param string $range IP address or CIDR range.
	 * @return bool
	 */
	public static function ip_in_range( string $ip, string $range ): bool {
		$parts   = explode( '/', $range, 2 );
		$address = @inet_pton( $ip ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- invalid input returns false, which is handled; the warning adds nothing.
		$subnet  = @inet_pton( $parts[0] ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- as above.

		if ( false === $address || false === $subnet || strlen( $address ) !== strlen( $subnet ) ) {
			return false;
		}

		$max_bits = strlen( $address ) * 8;
		$bits     = isset( $parts[1] ) ? $parts[1] : (string) $max_bits;

		if ( ! ctype_digit( $bits ) || (int) $bits > $max_bits ) {
			return false;
		}

		$bits  = (int) $bits;
		$bytes = intdiv( $bits, 8 );

		if ( substr( $address, 0, $bytes ) !== substr( $subnet, 0, $bytes ) ) {
			return false;
		}

		$remainder = $bits % 8;

		if ( 0 === $remainder ) {
			return true;
		}

		$mask = ( 0xff << ( 8 - $remainder ) ) & 0xff;

		return ( ord( $address[ $bytes ] ) & $mask ) === ( ord( $subnet[ $bytes ] ) & $mask );
	}

	/**
	 * Login buckets that apply to an attempt.
	 *
	 * @param string $username Username or email.
	 * @param string $ip       Client IP ('' when unknown).
	 * @return array<string, array{max: int, window: int}> Keyed by transient name.
	 */
	private static function login_buckets( string $username, string $ip ): array {
		$account = self::account_id( $username );
		$buckets = array(
			self::transient_name( 'login_acct', $account ) => array(
				'max'    => self::LOGIN_MAX_PER_ACCOUNT,
				'window' => self::LOGIN_WINDOW,
			),
		);

		if ( '' !== $ip ) {
			$buckets[ self::transient_name( 'login', $ip ) ]                          = array(
				'max'    => self::LOGIN_MAX_PER_IP,
				'window' => self::LOGIN_WINDOW,
			);
			$buckets[ self::transient_name( 'login_acct_ip', $account . '|' . $ip ) ] = array(
				'max'    => self::LOGIN_MAX_PER_ACCOUNT_AND_IP,
				'window' => self::LOGIN_WINDOW,
			);
		}

		return $buckets;
	}

	/**
	 * Registration buckets that apply to an IP.
	 *
	 * @param string $ip Client IP ('' when unknown).
	 * @return array<string, array{max: int, window: int}> Keyed by transient name.
	 */
	private static function register_buckets( string $ip ): array {
		if ( '' === $ip ) {
			return array();
		}

		return array(
			self::transient_name( 'register', $ip ) => array(
				'max'    => self::REGISTER_MAX_PER_IP,
				'window' => self::REGISTER_WINDOW,
			),
		);
	}

	/**
	 * Identifies the account a login targets.
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
	 * Seconds until every full bucket has reset; 0 when none is full.
	 *
	 * @param array<string, array{max: int, window: int}> $buckets Buckets.
	 * @return int
	 */
	private static function retry_after( array $buckets ): int {
		$now  = time();
		$wait = 0;

		foreach ( $buckets as $key => $bucket ) {
			$state = self::read( $key );

			if ( null !== $state && $state['count'] >= $bucket['max'] && $state['reset_at'] > $now ) {
				$wait = max( $wait, $state['reset_at'] - $now );
			}
		}

		return $wait;
	}

	/**
	 * Counts one attempt in every bucket, starting a new window where the
	 * previous one has ended.
	 *
	 * @param array<string, array{max: int, window: int}> $buckets Buckets.
	 */
	private static function hit( array $buckets ): void {
		$now = time();

		foreach ( $buckets as $key => $bucket ) {
			$state = self::read( $key );

			if ( null === $state || $state['reset_at'] <= $now ) {
				$state = array(
					'count'    => 0,
					'reset_at' => $now + $bucket['window'],
				);
			}

			++$state['count'];
			set_transient( $key, $state, max( 1, $state['reset_at'] - $now ) );
		}
	}

	/**
	 * Reads a bucket's state.
	 *
	 * @param string $key Transient name.
	 * @return array{count: int, reset_at: int}|null
	 */
	private static function read( string $key ): ?array {
		$state = get_transient( $key );

		if ( ! is_array( $state ) || ! isset( $state['count'], $state['reset_at'] ) ) {
			return null;
		}

		return array(
			'count'    => (int) $state['count'],
			'reset_at' => (int) $state['reset_at'],
		);
	}

	/**
	 * Transient name for a bucket, e.g. "bp_tracker_rl_login_<hash>".
	 *
	 * The value (an IP, an account) is keyed-hashed with a site secret: a
	 * plain hash of an IPv4 address can be reversed by trying all of them.
	 *
	 * @param string $bucket Bucket name.
	 * @param string $value  Value identifying the bucket.
	 * @return string
	 */
	public static function transient_name( string $bucket, string $value ): string {
		return self::TRANSIENT_PREFIX . $bucket . '_' . substr( hash_hmac( 'sha256', $value, wp_salt( 'auth' ) ), 0, 32 );
	}
}
