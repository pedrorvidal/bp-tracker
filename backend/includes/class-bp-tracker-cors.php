<?php
/**
 * CORS policy for the plugin's own REST namespace.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_CORS
 *
 * WordPress core's rest_send_cors_headers() reflects any request Origin
 * with Access-Control-Allow-Credentials: true. For the bp-tracker/v1
 * namespace this class replaces that with a strict allow-list of exactly
 * one origin, BP_TRACKER_FRONTEND_ORIGIN. Credentials are allowed for that
 * origin only, so the frontend can send the HttpOnly refresh cookie to the
 * auth routes. Other namespaces keep core's default behavior.
 */
class BP_Tracker_CORS {

	/**
	 * REST namespace this policy applies to.
	 *
	 * @var string
	 */
	const REST_NAMESPACE = 'bp-tracker/v1';

	/**
	 * Methods used by the plugin's routes.
	 *
	 * @var string
	 */
	const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

	/**
	 * Request headers the frontend sends.
	 *
	 * @var string
	 */
	const ALLOWED_HEADERS = 'Authorization, Content-Type, ' . BP_Tracker_JWT_Auth::CSRF_HEADER;

	/**
	 * How long browsers may cache a preflight result, in seconds.
	 *
	 * @var int
	 */
	const MAX_AGE = 600;

	/**
	 * Hooks in ahead of core's rest_send_cors_headers (priority 10).
	 */
	public static function init(): void {
		add_filter( 'rest_pre_serve_request', array( __CLASS__, 'maybe_send_cors_headers' ), 5, 3 );
	}

	/**
	 * Sends the plugin's CORS headers for its own namespace and stops core
	 * from sending its permissive ones.
	 *
	 * @param mixed           $served  Whether the request has already been served.
	 * @param mixed           $result  Response to send (unused).
	 * @param WP_REST_Request $request Current request.
	 * @return mixed $served, unchanged.
	 */
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundBeforeLastUsed -- signature must match the "rest_pre_serve_request" filter.
	public static function maybe_send_cors_headers( mixed $served, mixed $result, WP_REST_Request $request ): mixed {
		if ( ! self::is_own_route( $request->get_route() ) ) {
			return $served;
		}

		// Runs at priority 5, so core's callback (priority 10) has not run yet
		// and removing it here skips it for this request.
		remove_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );

		$headers = self::get_cors_headers( get_http_origin(), self::get_allowed_origin() );

		if ( ! headers_sent() ) {
			foreach ( $headers as $name => $value ) {
				header( $name . ': ' . $value, 'Vary' !== $name );
			}
		}

		return $served;
	}

	/**
	 * Builds the CORS response headers for a request Origin.
	 *
	 * Only an exact match (scheme, host and port) with the configured origin
	 * gets Access-Control-Allow-* headers; anything else gets none, so the
	 * browser blocks the response. Credentials are allowed for that origin
	 * so it can send the refresh cookie; the origin is never reflected.
	 *
	 * @param string $origin         Request Origin header ('' when absent).
	 * @param string $allowed_origin Configured frontend origin ('' when not configured).
	 * @return array<string, string> Header name => value.
	 */
	public static function get_cors_headers( string $origin, string $allowed_origin ): array {
		// The response differs per Origin, so caches must key on it either way.
		$headers = array( 'Vary' => 'Origin' );

		$allowed_origin = strtolower( untrailingslashit( $allowed_origin ) );

		if ( '' === $allowed_origin || strtolower( untrailingslashit( $origin ) ) !== $allowed_origin ) {
			return $headers;
		}

		return array(
			'Access-Control-Allow-Origin'      => $allowed_origin,
			'Access-Control-Allow-Methods'     => self::ALLOWED_METHODS,
			'Access-Control-Allow-Headers'     => self::ALLOWED_HEADERS,
			'Access-Control-Allow-Credentials' => 'true',
			'Access-Control-Max-Age'           => (string) self::MAX_AGE,
		) + $headers;
	}

	/**
	 * Whether a REST route belongs to the plugin's namespace.
	 *
	 * @param string $route REST route, e.g. "/bp-tracker/v1/readings".
	 * @return bool
	 */
	public static function is_own_route( string $route ): bool {
		$prefix = '/' . self::REST_NAMESPACE;

		return $route === $prefix || str_starts_with( $route, $prefix . '/' );
	}

	/**
	 * Reads BP_TRACKER_FRONTEND_ORIGIN from wp-config.php.
	 *
	 * @return string The configured origin, or '' when not configured.
	 */
	private static function get_allowed_origin(): string {
		if ( ! defined( 'BP_TRACKER_FRONTEND_ORIGIN' ) ) {
			return '';
		}

		$origin = constant( 'BP_TRACKER_FRONTEND_ORIGIN' );

		return is_string( $origin ) ? $origin : '';
	}
}

BP_Tracker_CORS::init();
