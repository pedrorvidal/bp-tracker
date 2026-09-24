<?php
/**
 * Keeps app users (pending and approved) out of WordPress itself.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_Access_Control
 *
 * Users with the bp_tracker_pending or bp_tracker_user role only ever use
 * the React app. They are sent back to it from wp-admin and from the native
 * login form, and they can't call REST routes outside bp-tracker/v1.
 * Administrators are never restricted, even if they also hold one of the
 * app roles.
 */
class BP_Tracker_Access_Control {

	/**
	 * Roles restricted to the app.
	 *
	 * @var string[]
	 */
	const RESTRICTED_ROLES = array(
		BP_Tracker_Roles::PENDING,
		BP_Tracker_Roles::USER,
	);

	/**
	 * Wires up the wp-admin, login and REST restrictions.
	 */
	public static function init(): void {
		add_action( 'admin_init', array( __CLASS__, 'redirect_from_admin' ) );
		add_filter( 'login_redirect', array( __CLASS__, 'filter_login_redirect' ), 10, 3 );
		add_filter( 'rest_pre_dispatch', array( __CLASS__, 'restrict_rest_routes' ), 10, 3 );
		add_filter( 'allowed_redirect_hosts', array( __CLASS__, 'allow_frontend_host' ) );
	}

	/**
	 * Whether a user is limited to the app.
	 *
	 * @param WP_User $user User to check.
	 * @return bool
	 */
	public static function is_restricted( WP_User $user ): bool {
		if ( in_array( 'administrator', $user->roles, true ) ) {
			return false;
		}

		return array() !== array_intersect( self::RESTRICTED_ROLES, $user->roles );
	}

	/**
	 * Decides whether a wp-admin request must be sent back to the app.
	 *
	 * AJAX and REST requests go through wp-admin too (admin-ajax.php), but
	 * redirecting them would only break them: they are left alone.
	 *
	 * @param WP_User $user         Current user.
	 * @param bool    $doing_ajax   Whether this is an AJAX request.
	 * @param bool    $rest_request Whether this is a REST request.
	 * @return bool
	 */
	public static function should_redirect_from_admin( WP_User $user, bool $doing_ajax, bool $rest_request ): bool {
		return ! $doing_ajax && ! $rest_request && self::is_restricted( $user );
	}

	/**
	 * Sends restricted users from any wp-admin page back to the app.
	 */
	public static function redirect_from_admin(): void {
		if ( ! self::should_redirect_from_admin( wp_get_current_user(), wp_doing_ajax(), defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}

		wp_safe_redirect( self::frontend_url() );
		exit;
	}

	/**
	 * After a native wp-login.php login, sends restricted users to the app,
	 * whatever redirect_to was requested.
	 *
	 * @param string           $redirect_to           Destination WordPress chose.
	 * @param string           $requested_redirect_to Destination the request asked for.
	 * @param WP_User|WP_Error $user                  Logged-in user, or the login error.
	 * @return string
	 */
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundInExtendedClassBeforeLastUsed, Generic.CodeAnalysis.UnusedFunctionParameter.FoundBeforeLastUsed -- signature must match the "login_redirect" filter.
	public static function filter_login_redirect( string $redirect_to, string $requested_redirect_to, WP_User|WP_Error $user ): string {
		if ( $user instanceof WP_User && self::is_restricted( $user ) ) {
			return self::frontend_url();
		}

		return $redirect_to;
	}

	/**
	 * Refuses REST routes outside bp-tracker/v1 to restricted users.
	 *
	 * Logged-out requests and unrestricted users (administrators) pass
	 * through untouched, and so does a result an earlier filter already set.
	 *
	 * @param mixed           $result  Response so far (null to continue).
	 * @param WP_REST_Server  $server  REST server.
	 * @param WP_REST_Request $request Current request.
	 * @return mixed
	 */
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundInExtendedClassBeforeLastUsed, Generic.CodeAnalysis.UnusedFunctionParameter.FoundBeforeLastUsed -- signature must match the "rest_pre_dispatch" filter.
	public static function restrict_rest_routes( mixed $result, WP_REST_Server $server, WP_REST_Request $request ): mixed {
		if ( null !== $result || ! is_user_logged_in() ) {
			return $result;
		}

		if ( ! self::is_restricted( wp_get_current_user() ) || BP_Tracker_CORS::is_own_route( $request->get_route() ) ) {
			return $result;
		}

		return new WP_Error(
			'bp_tracker_forbidden_route',
			__( 'This route is not available for your account.', 'bp-tracker' ),
			array( 'status' => 403 )
		);
	}

	/**
	 * Lets wp_safe_redirect() go to the frontend's host, which may differ
	 * from the site's (otherwise it would fall back to wp-admin and loop).
	 *
	 * @param string[] $hosts Allowed hosts.
	 * @return string[]
	 */
	public static function allow_frontend_host( array $hosts ): array {
		$host = wp_parse_url( BP_Tracker_CORS::get_allowed_origin(), PHP_URL_HOST );

		if ( is_string( $host ) && '' !== $host ) {
			$hosts[] = $host;
		}

		return $hosts;
	}

	/**
	 * Where restricted users are sent: the app, or the site's home when no
	 * frontend origin is configured.
	 *
	 * @return string
	 */
	public static function frontend_url(): string {
		$origin = BP_Tracker_CORS::get_allowed_origin();

		return '' !== $origin ? $origin : home_url( '/' );
	}
}

BP_Tracker_Access_Control::init();
