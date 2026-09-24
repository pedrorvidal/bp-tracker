<?php
/**
 * Tests for BP_Tracker_Access_Control.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_Access_Control_Test
 */
class BP_Tracker_Access_Control_Test extends WP_UnitTestCase {

	/**
	 * Resets the current user between tests.
	 */
	public function tearDown(): void {
		wp_set_current_user( 0 );

		parent::tearDown();
	}

	/**
	 * Creates a user with the given roles (the first one set, the rest added).
	 *
	 * @param string ...$roles Roles.
	 * @return WP_User
	 */
	private function user_with( string ...$roles ): WP_User {
		$user = self::factory()->user->create_and_get( array( 'role' => array_shift( $roles ) ) );

		foreach ( $roles as $role ) {
			$user->add_role( $role );
		}

		return $user;
	}

	/**
	 * Dispatches a GET request as the given user (0 for logged out).
	 *
	 * @param int    $user_id User ID.
	 * @param string $route   Route.
	 * @return WP_REST_Response
	 */
	private function get_as( int $user_id, string $route ): WP_REST_Response {
		wp_set_current_user( $user_id );

		return rest_get_server()->dispatch( new WP_REST_Request( 'GET', $route ) );
	}

	/**
	 * Only the app roles are restricted, and never an administrator.
	 */
	public function test_is_restricted(): void {
		$this->assertTrue( BP_Tracker_Access_Control::is_restricted( $this->user_with( BP_Tracker_Roles::USER ) ) );
		$this->assertTrue( BP_Tracker_Access_Control::is_restricted( $this->user_with( BP_Tracker_Roles::PENDING ) ) );
		$this->assertFalse( BP_Tracker_Access_Control::is_restricted( $this->user_with( 'administrator' ) ) );
		$this->assertFalse( BP_Tracker_Access_Control::is_restricted( $this->user_with( 'administrator', BP_Tracker_Roles::USER ) ) );
		$this->assertFalse( BP_Tracker_Access_Control::is_restricted( $this->user_with( 'editor' ) ) );
		$this->assertFalse( BP_Tracker_Access_Control::is_restricted( new WP_User() ) );
	}

	/**
	 * App users are sent away from wp-admin page loads, but not from AJAX
	 * or REST requests; administrators never are.
	 */
	public function test_should_redirect_from_admin(): void {
		$app_user = $this->user_with( BP_Tracker_Roles::USER );
		$pending  = $this->user_with( BP_Tracker_Roles::PENDING );
		$admin    = $this->user_with( 'administrator' );

		$this->assertTrue( BP_Tracker_Access_Control::should_redirect_from_admin( $app_user, false, false ) );
		$this->assertTrue( BP_Tracker_Access_Control::should_redirect_from_admin( $pending, false, false ) );
		$this->assertFalse( BP_Tracker_Access_Control::should_redirect_from_admin( $app_user, true, false ) );
		$this->assertFalse( BP_Tracker_Access_Control::should_redirect_from_admin( $app_user, false, true ) );
		$this->assertFalse( BP_Tracker_Access_Control::should_redirect_from_admin( $admin, false, false ) );
	}

	/**
	 * The admin_init hook is registered, and a no-op (no exit) for admins.
	 */
	public function test_redirect_hook_leaves_administrators_alone(): void {
		$this->assertSame( 10, has_action( 'admin_init', array( BP_Tracker_Access_Control::class, 'redirect_from_admin' ) ) );

		wp_set_current_user( $this->user_with( 'administrator' )->ID );
		BP_Tracker_Access_Control::redirect_from_admin();

		// Reaching this line means it neither redirected nor exited.
		$this->assertTrue( true );
	}

	/**
	 * The redirect target is the frontend, and wp_safe_redirect() accepts it.
	 */
	public function test_redirect_target_is_the_frontend(): void {
		$this->assertSame( BP_TRACKER_FRONTEND_ORIGIN, BP_Tracker_Access_Control::frontend_url() );
		$this->assertSame( BP_TRACKER_FRONTEND_ORIGIN, wp_validate_redirect( BP_Tracker_Access_Control::frontend_url(), 'fallback' ) );
	}

	/**
	 * A native login by an app user ends in the app, whatever was requested.
	 */
	public function test_login_redirect_sends_app_users_to_the_frontend(): void {
		$requested = admin_url( 'users.php' );

		$this->assertSame(
			BP_TRACKER_FRONTEND_ORIGIN,
			apply_filters( 'login_redirect', $requested, $requested, $this->user_with( BP_Tracker_Roles::USER ) )
		);
		$this->assertSame(
			BP_TRACKER_FRONTEND_ORIGIN,
			apply_filters( 'login_redirect', $requested, $requested, $this->user_with( BP_Tracker_Roles::PENDING ) )
		);
	}

	/**
	 * Administrators and failed logins keep WordPress' redirect.
	 */
	public function test_login_redirect_keeps_other_destinations(): void {
		$requested = admin_url( 'users.php' );

		$this->assertSame( $requested, apply_filters( 'login_redirect', $requested, $requested, $this->user_with( 'administrator' ) ) );
		$this->assertSame( $requested, apply_filters( 'login_redirect', $requested, $requested, new WP_Error( 'invalid_username' ) ) );
	}

	/**
	 * App users get 403 on any route outside bp-tracker/v1.
	 *
	 * @dataProvider data_foreign_routes
	 *
	 * @param string $route Route outside the plugin's namespace.
	 */
	public function test_app_user_is_refused_routes_outside_the_namespace( string $route ): void {
		foreach ( array( BP_Tracker_Roles::USER, BP_Tracker_Roles::PENDING ) as $role ) {
			$response = $this->get_as( $this->user_with( $role )->ID, $route );

			$this->assertSame( 403, $response->get_status(), $role . ' ' . $route );
			$this->assertSame( 'bp_tracker_forbidden_route', $response->as_error()->get_error_code() );
			$this->assertSame( 'This route is not available for your account.', $response->as_error()->get_error_message() );
		}
	}

	/**
	 * Core routes that app users must not reach.
	 *
	 * @return array<string, array{string}>
	 */
	public static function data_foreign_routes(): array {
		return array(
			'current user' => array( '/wp/v2/users/me' ),
			'users'        => array( '/wp/v2/users' ),
			'posts'        => array( '/wp/v2/posts' ),
			'index'        => array( '/' ),
		);
	}

	/**
	 * The plugin's own routes keep working for app users.
	 */
	public function test_app_user_keeps_the_plugin_routes(): void {
		$user_id = $this->user_with( BP_Tracker_Roles::USER )->ID;

		$this->assertSame( 200, $this->get_as( $user_id, '/bp-tracker/v1/readings' )->get_status() );
		$this->assertSame( 200, $this->get_as( $user_id, '/bp-tracker/v1/stats' )->get_status() );
	}

	/**
	 * Only the exact namespace counts: a look-alike prefix is foreign.
	 */
	public function test_namespace_match_is_exact(): void {
		$this->assertTrue( BP_Tracker_CORS::is_own_route( '/bp-tracker/v1' ) );
		$this->assertTrue( BP_Tracker_CORS::is_own_route( '/bp-tracker/v1/readings' ) );
		$this->assertFalse( BP_Tracker_CORS::is_own_route( '/bp-tracker/v10/readings' ) );
		$this->assertFalse( BP_Tracker_CORS::is_own_route( '/wp/v2/bp-tracker/v1' ) );
	}

	/**
	 * Administrators reach core routes normally.
	 */
	public function test_administrator_reaches_any_route(): void {
		$admin_id = $this->user_with( 'administrator' )->ID;

		$me = $this->get_as( $admin_id, '/wp/v2/users/me' );
		$this->assertSame( 200, $me->get_status() );
		$this->assertSame( $admin_id, $me->get_data()['id'] );
		$this->assertSame( 200, $this->get_as( $admin_id, '/wp/v2/users' )->get_status() );
		$this->assertSame( 200, $this->get_as( $admin_id, '/bp-tracker/v1/readings' )->get_status() );
	}

	/**
	 * Logged-out requests are not touched (core decides as usual).
	 */
	public function test_logged_out_requests_are_not_blocked(): void {
		$this->assertSame( 200, $this->get_as( 0, '/wp/v2/posts' )->get_status() );
		$this->assertSame( 401, $this->get_as( 0, '/wp/v2/users/me' )->get_status() );
	}

	/**
	 * A result set by an earlier rest_pre_dispatch filter is kept.
	 */
	public function test_earlier_result_is_kept(): void {
		wp_set_current_user( $this->user_with( BP_Tracker_Roles::USER )->ID );
		$earlier = new WP_REST_Response( array( 'cached' => true ) );

		$this->assertSame(
			$earlier,
			BP_Tracker_Access_Control::restrict_rest_routes( $earlier, rest_get_server(), new WP_REST_Request( 'GET', '/wp/v2/posts' ) )
		);
	}
}
