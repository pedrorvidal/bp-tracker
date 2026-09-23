<?php
/**
 * Tests for BP_Tracker_CORS.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_CORS_Test
 */
class BP_Tracker_CORS_Test extends WP_UnitTestCase {

	/**
	 * Origin configured as the frontend in these tests.
	 *
	 * @var string
	 */
	private const FRONTEND = 'http://localhost:5173';

	/**
	 * Clears the simulated Origin header, even if a test failed midway.
	 */
	public function tearDown(): void {
		unset( $_SERVER['HTTP_ORIGIN'] );

		parent::tearDown();
	}

	/**
	 * The configured frontend origin gets every header a preflight for
	 * GET/POST/PUT/DELETE with a Bearer token needs.
	 */
	public function test_allowed_origin_gets_full_cors_headers(): void {
		$headers = BP_Tracker_CORS::get_cors_headers( self::FRONTEND, self::FRONTEND );

		$this->assertSame( self::FRONTEND, $headers['Access-Control-Allow-Origin'] );
		$this->assertSame( 'Origin', $headers['Vary'] );
		$this->assertArrayHasKey( 'Access-Control-Max-Age', $headers );

		$methods = array_map( 'trim', explode( ',', $headers['Access-Control-Allow-Methods'] ) );
		foreach ( array( 'GET', 'POST', 'PUT', 'DELETE', 'OPTIONS' ) as $method ) {
			$this->assertContains( $method, $methods, "Preflight must allow {$method}." );
		}

		$allowed_headers = array_map( 'strtolower', array_map( 'trim', explode( ',', $headers['Access-Control-Allow-Headers'] ) ) );
		$this->assertContains( 'authorization', $allowed_headers );
		$this->assertContains( 'content-type', $allowed_headers );
	}

	/**
	 * Auth is Bearer-only, so cookies must never be allowed cross-origin.
	 */
	public function test_credentials_are_never_allowed(): void {
		$headers = BP_Tracker_CORS::get_cors_headers( self::FRONTEND, self::FRONTEND );

		$this->assertArrayNotHasKey( 'Access-Control-Allow-Credentials', $headers );
	}

	/**
	 * A trailing slash or different casing in the configured origin still matches,
	 * and the response always carries the canonical configured value.
	 */
	public function test_configured_origin_is_normalized(): void {
		$headers = BP_Tracker_CORS::get_cors_headers( self::FRONTEND, 'HTTP://LOCALHOST:5173/' );

		$this->assertSame( 'http://localhost:5173', $headers['Access-Control-Allow-Origin'] );
	}

	/**
	 * Any origin other than the configured one gets no Allow-* headers, so the
	 * browser blocks the request.
	 *
	 * @dataProvider provide_rejected_origins
	 *
	 * @param string $origin         Request Origin header.
	 * @param string $allowed_origin Configured frontend origin.
	 */
	public function test_rejected_origins_get_no_allow_headers( string $origin, string $allowed_origin ): void {
		$headers = BP_Tracker_CORS::get_cors_headers( $origin, $allowed_origin );

		$this->assertSame( array( 'Vary' => 'Origin' ), $headers );
	}

	/**
	 * Origins that must be rejected.
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public static function provide_rejected_origins(): array {
		return array(
			'foreign origin'                 => array( 'https://evil.example', self::FRONTEND ),
			'same host, other port'          => array( 'http://localhost:5174', self::FRONTEND ),
			'same host, other scheme'        => array( 'https://localhost:5173', self::FRONTEND ),
			'configured origin as a prefix'  => array( 'http://localhost:51730', self::FRONTEND ),
			'configured origin as subdomain' => array( 'http://localhost:5173.evil.example', self::FRONTEND ),
			'opaque "null" origin'           => array( 'null', self::FRONTEND ),
			'no Origin header'               => array( '', self::FRONTEND ),
			'frontend origin not configured' => array( self::FRONTEND, '' ),
			'nothing configured nor sent'    => array( '', '' ),
		);
	}

	/**
	 * Only routes in the plugin's own namespace are handled.
	 */
	public function test_is_own_route(): void {
		$this->assertTrue( BP_Tracker_CORS::is_own_route( '/bp-tracker/v1' ) );
		$this->assertTrue( BP_Tracker_CORS::is_own_route( '/bp-tracker/v1/readings/6' ) );
		$this->assertTrue( BP_Tracker_CORS::is_own_route( '/bp-tracker/v1/auth/login' ) );

		$this->assertFalse( BP_Tracker_CORS::is_own_route( '/wp/v2/posts' ) );
		$this->assertFalse( BP_Tracker_CORS::is_own_route( '/bp-tracker/v10/readings' ) );
		$this->assertFalse( BP_Tracker_CORS::is_own_route( '/bp-tracker/v1-legacy/readings' ) );
		$this->assertFalse( BP_Tracker_CORS::is_own_route( '/' ) );
	}

	/**
	 * The plugin's filter runs before core's rest_send_cors_headers (priority 10),
	 * so it can stop core from reflecting arbitrary origins.
	 */
	public function test_filter_runs_before_core_cors(): void {
		$priority = has_filter( 'rest_pre_serve_request', array( BP_Tracker_CORS::class, 'maybe_send_cors_headers' ) );

		$this->assertIsInt( $priority );
		$this->assertLessThan( 10, $priority );
	}

	/**
	 * For the plugin's namespace, core's permissive CORS callback is removed
	 * before it runs, and the "served" flag is passed through untouched.
	 */
	public function test_own_route_disables_core_cors(): void {
		add_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );

		$served = BP_Tracker_CORS::maybe_send_cors_headers( false, null, new WP_REST_Request( 'OPTIONS', '/bp-tracker/v1/readings/6' ) );

		$this->assertFalse( $served );
		$this->assertFalse( has_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' ) );
	}

	/**
	 * Other namespaces keep WordPress core's default CORS behavior.
	 */
	public function test_other_routes_keep_core_cors(): void {
		add_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );

		$served = BP_Tracker_CORS::maybe_send_cors_headers( true, null, new WP_REST_Request( 'GET', '/wp/v2/posts' ) );

		$this->assertTrue( $served );
		$this->assertSame( 10, has_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' ) );
	}

	/**
	 * Runs the whole rest_pre_serve_request hook (plugin + real core callback)
	 * for a route and counts how many times the request Origin was read.
	 *
	 * Both callbacks read it through get_http_origin(), which applies the
	 * "http_origin" filter, so the count reveals which of them actually ran.
	 *
	 * @param string $route  REST route being served.
	 * @param string $origin Request Origin header ('' for none).
	 * @return int
	 */
	private function count_origin_reads_while_serving( string $route, string $origin ): int {
		$reads = 0;
		add_filter(
			'http_origin',
			static function ( $origin ) use ( &$reads ) {
				++$reads;
				return $origin;
			}
		);
		add_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );

		if ( '' !== $origin ) {
			$_SERVER['HTTP_ORIGIN'] = $origin;
		}
		apply_filters( 'rest_pre_serve_request', false, null, new WP_REST_Request( 'OPTIONS', $route ), rest_get_server() );

		return $reads;
	}

	/**
	 * End to end through the real hook: for the plugin's namespace only the
	 * plugin reads the Origin; core's origin-reflecting callback never runs.
	 *
	 * Were it to run, core would also call header() for this foreign origin,
	 * which errors under the CLI test runner — a second, independent signal.
	 */
	public function test_core_cors_never_runs_for_own_route(): void {
		$this->assertSame( 1, $this->count_origin_reads_while_serving( '/bp-tracker/v1/readings', 'https://evil.example' ) );
	}

	/**
	 * Control for the test above: for other namespaces the plugin steps aside
	 * and core's callback is what reads the Origin. (No Origin header here, so
	 * core reads it but skips header(), which the CLI runner can't send.)
	 */
	public function test_core_cors_still_runs_for_other_routes(): void {
		$this->assertSame( 1, $this->count_origin_reads_while_serving( '/wp/v2/posts', '' ) );
		$this->assertSame( 10, has_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' ) );
	}
}
