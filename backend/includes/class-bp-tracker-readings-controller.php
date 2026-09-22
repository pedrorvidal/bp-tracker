<?php
/**
 * REST controller restricting "bp_reading" reads to the post's own author.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_Readings_Controller
 */
class BP_Tracker_Readings_Controller extends WP_REST_Posts_Controller {

	/**
	 * Requires an authenticated user to list readings.
	 *
	 * The collection itself is further scoped to the current user's own
	 * posts by BP_Tracker_CPT::scope_query_to_current_user().
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	public function get_items_permissions_check( $request ): bool|WP_Error {
		if ( ! is_user_logged_in() ) {
			return self::login_required_error();
		}

		return true;
	}

	/**
	 * Requires an authenticated user reading one of their own readings.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	public function get_item_permissions_check( $request ): bool|WP_Error {
		if ( ! is_user_logged_in() ) {
			return self::login_required_error();
		}

		$post = $this->get_post( $request['id'] );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		if ( get_current_user_id() !== (int) $post->post_author ) {
			return new WP_Error(
				'bp_tracker_rest_forbidden',
				__( 'You can only view your own readings.', 'bp-tracker' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Builds the standard "must be logged in" REST error.
	 *
	 * @return WP_Error
	 */
	private static function login_required_error(): WP_Error {
		return new WP_Error(
			'bp_tracker_rest_forbidden',
			__( 'You must be logged in to view readings.', 'bp-tracker' ),
			array( 'status' => 401 )
		);
	}
}
