<?php
/**
 * REST controller for the plugin's own bp-tracker/v1/readings + /stats API.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_REST_Controller
 */
class BP_Tracker_REST_Controller extends WP_REST_Controller {

	/**
	 * Meta keys carried on every reading, in the order they appear in responses.
	 *
	 * @var string[]
	 */
	const META_KEYS = array( 'reading_datetime', 'systolic', 'diastolic', 'pulse', 'weight', 'notes' );

	/**
	 * Sets the namespace/base this controller's routes live under.
	 */
	public function __construct() {
		$this->namespace = 'bp-tracker/v1';
		$this->rest_base = 'readings';
	}

	/**
	 * Registers the controller's routes.
	 */
	public static function init(): void {
		add_action(
			'rest_api_init',
			static function (): void {
				( new self() )->register_routes();
			}
		);
	}

	/**
	 * Registers /readings, /readings/{id} and /stats.
	 */
	public function register_routes(): void {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => self::item_schema_args( true ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => self::item_schema_args( false ),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/stats',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_stats' ),
				'permission_callback' => array( $this, 'get_items_permissions_check' ),
				'args'                => array(
					'period_start' => array(
						'type'   => 'string',
						'format' => 'date-time',
					),
					'period_end'   => array(
						'type'   => 'string',
						'format' => 'date-time',
					),
				),
			)
		);
	}

	/**
	 * Query args accepted by GET /readings.
	 *
	 * @return array<string, mixed>
	 */
	public function get_collection_params(): array {
		return array(
			'page'         => array(
				'type'    => 'integer',
				'default' => 1,
				'minimum' => 1,
			),
			'per_page'     => array(
				'type'    => 'integer',
				'default' => 10,
				'minimum' => 1,
				'maximum' => 100,
			),
			'period_start' => array(
				'type'   => 'string',
				'format' => 'date-time',
			),
			'period_end'   => array(
				'type'   => 'string',
				'format' => 'date-time',
			),
		);
	}

	/**
	 * Lists the current user's readings, newest first, optionally filtered by period.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ): WP_REST_Response {
		$period_start = $request->get_param( 'period_start' );
		$period_end   = $request->get_param( 'period_end' );
		$page         = max( 1, (int) $request->get_param( 'page' ) );
		$per_page     = min( 100, max( 1, (int) $request->get_param( 'per_page' ) ) );

		$posts = self::query_own_posts()->posts;

		$posts = array_values(
			array_filter(
				$posts,
				static function ( WP_Post $post ) use ( $period_start, $period_end ): bool {
					return self::within_period( (string) get_post_meta( $post->ID, 'reading_datetime', true ), $period_start, $period_end );
				}
			)
		);

		$total       = count( $posts );
		$total_pages = (int) ceil( $total / $per_page );
		$page_posts  = array_slice( $posts, ( $page - 1 ) * $per_page, $per_page );

		$response = new WP_REST_Response( array_map( array( $this, 'format_item' ), $page_posts ) );
		$response->header( 'X-WP-Total', (string) $total );
		$response->header( 'X-WP-TotalPages', (string) $total_pages );

		return $response;
	}

	/**
	 * Creates a reading owned by the current user.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ): WP_REST_Response|WP_Error {
		$post_id = wp_insert_post(
			array(
				'post_type'   => BP_Tracker_CPT::POST_TYPE,
				'post_status' => 'publish',
				'post_author' => get_current_user_id(),
				'meta_input'  => self::collect_meta_input( $request ),
			),
			true
		);

		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			return self::not_found_error();
		}

		return new WP_REST_Response( $this->format_item( $post ), 201 );
	}

	/**
	 * Returns a single reading owned by the current user.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ): WP_REST_Response|WP_Error {
		$post = self::get_own_reading( (int) $request->get_param( 'id' ) );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		return new WP_REST_Response( $this->format_item( $post ) );
	}

	/**
	 * Updates (partially) a reading owned by the current user.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ): WP_REST_Response|WP_Error {
		$post = self::get_own_reading( (int) $request->get_param( 'id' ) );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		foreach ( self::collect_meta_input( $request ) as $key => $value ) {
			$updated = update_post_meta( $post->ID, $key, $value );

			if ( false === $updated && (string) get_post_meta( $post->ID, $key, true ) !== (string) $value ) {
				return new WP_Error(
					'bp_tracker_rest_invalid_value',
					/* translators: %s: meta key name. */
					sprintf( __( 'Invalid value for "%s".', 'bp-tracker' ), $key ),
					array( 'status' => 400 )
				);
			}
		}

		$post = get_post( $post->ID );

		if ( ! $post instanceof WP_Post ) {
			return self::not_found_error();
		}

		return new WP_REST_Response( $this->format_item( $post ) );
	}

	/**
	 * Deletes a reading owned by the current user.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ): WP_REST_Response|WP_Error {
		$post = self::get_own_reading( (int) $request->get_param( 'id' ) );

		if ( is_wp_error( $post ) ) {
			return $post;
		}

		if ( ! wp_delete_post( $post->ID, true ) ) {
			return new WP_Error(
				'bp_tracker_rest_delete_failed',
				__( 'Could not delete the reading.', 'bp-tracker' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'id'      => $post->ID,
			)
		);
	}

	/**
	 * Returns systolic/diastolic/pulse averages, minimums and maximums and a
	 * count for the current user's readings within an optional period.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return WP_REST_Response
	 */
	public function get_stats( $request ): WP_REST_Response {
		$period_start = $request->get_param( 'period_start' );
		$period_end   = $request->get_param( 'period_end' );

		$systolic  = array();
		$diastolic = array();
		$pulse     = array();

		foreach ( self::query_own_posts()->posts as $post ) {
			if ( ! self::within_period( (string) get_post_meta( $post->ID, 'reading_datetime', true ), $period_start, $period_end ) ) {
				continue;
			}

			$systolic[]  = (int) get_post_meta( $post->ID, 'systolic', true );
			$diastolic[] = (int) get_post_meta( $post->ID, 'diastolic', true );

			$reading_pulse = get_post_meta( $post->ID, 'pulse', true );
			if ( '' !== $reading_pulse ) {
				$pulse[] = (int) $reading_pulse;
			}
		}

		return new WP_REST_Response(
			array(
				'count'             => count( $systolic ),
				'systolic_average'  => self::average( $systolic ),
				'diastolic_average' => self::average( $diastolic ),
				'pulse_average'     => self::average( $pulse ),
				'systolic_min'      => self::minimum( $systolic ),
				'systolic_max'      => self::maximum( $systolic ),
				'diastolic_min'     => self::minimum( $diastolic ),
				'diastolic_max'     => self::maximum( $diastolic ),
				'pulse_min'         => self::minimum( $pulse ),
				'pulse_max'         => self::maximum( $pulse ),
			)
		);
	}

	/**
	 * Requires an authenticated user.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	public function get_items_permissions_check( $request ): bool|WP_Error {
		return is_user_logged_in() ? true : self::login_required_error();
	}

	/**
	 * Requires an authenticated user.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	public function create_item_permissions_check( $request ): bool|WP_Error {
		return is_user_logged_in() ? true : self::login_required_error();
	}

	/**
	 * Requires an authenticated user reading their own reading.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	public function get_item_permissions_check( $request ): bool|WP_Error {
		return self::check_owner( (int) $request->get_param( 'id' ) );
	}

	/**
	 * Requires an authenticated user updating their own reading.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	public function update_item_permissions_check( $request ): bool|WP_Error {
		return self::check_owner( (int) $request->get_param( 'id' ) );
	}

	/**
	 * Requires an authenticated user deleting their own reading.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return true|WP_Error
	 */
	public function delete_item_permissions_check( $request ): bool|WP_Error {
		return self::check_owner( (int) $request->get_param( 'id' ) );
	}

	/**
	 * Shared ownership check for the single-item routes.
	 *
	 * @param int $post_id Reading ID being accessed.
	 * @return true|WP_Error
	 */
	private static function check_owner( int $post_id ): bool|WP_Error {
		if ( ! is_user_logged_in() ) {
			return self::login_required_error();
		}

		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post || BP_Tracker_CPT::POST_TYPE !== $post->post_type || 'publish' !== $post->post_status ) {
			return self::not_found_error();
		}

		if ( get_current_user_id() !== (int) $post->post_author ) {
			return new WP_Error(
				'bp_tracker_rest_forbidden',
				__( 'You can only access your own readings.', 'bp-tracker' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Fetches a reading, already scoped to the current user.
	 *
	 * check_owner() (run as the route's permission_callback) has already
	 * verified existence and ownership by the time this runs.
	 *
	 * @param int $post_id Reading ID.
	 * @return WP_Post|WP_Error
	 */
	private static function get_own_reading( int $post_id ): WP_Post|WP_Error {
		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			return self::not_found_error();
		}

		return $post;
	}

	/**
	 * Queries every published reading owned by the current user.
	 *
	 * @return WP_Query
	 */
	private static function query_own_posts(): WP_Query {
		return new WP_Query(
			array(
				'post_type'      => BP_Tracker_CPT::POST_TYPE,
				'post_status'    => 'publish',
				'author'         => get_current_user_id(),
				'posts_per_page' => -1,
				'orderby'        => 'meta_value',
				'meta_key'       => 'reading_datetime',
				'order'          => 'DESC',
				'no_found_rows'  => true,
			)
		);
	}

	/**
	 * Checks whether an ISO 8601 datetime falls within an optional period.
	 *
	 * @param string $reading_datetime Reading's stored datetime.
	 * @param mixed  $period_start     Optional inclusive lower bound.
	 * @param mixed  $period_end       Optional inclusive upper bound.
	 * @return bool
	 */
	private static function within_period( string $reading_datetime, mixed $period_start, mixed $period_end ): bool {
		$timestamp = strtotime( $reading_datetime );

		if ( false === $timestamp ) {
			return false;
		}

		if ( $period_start && $timestamp < strtotime( (string) $period_start ) ) {
			return false;
		}

		if ( $period_end && $timestamp > strtotime( (string) $period_end ) ) {
			return false;
		}

		return true;
	}

	/**
	 * Averages a list of numbers, rounded to one decimal place.
	 *
	 * @param int[] $values Values to average.
	 * @return float|null Null when $values is empty.
	 */
	private static function average( array $values ): ?float {
		if ( ! $values ) {
			return null;
		}

		return round( array_sum( $values ) / count( $values ), 1 );
	}

	/**
	 * Smallest of a list of numbers.
	 *
	 * @param int[] $values Values.
	 * @return int|null Null when $values is empty.
	 */
	private static function minimum( array $values ): ?int {
		return $values ? min( $values ) : null;
	}

	/**
	 * Largest of a list of numbers.
	 *
	 * @param int[] $values Values.
	 * @return int|null Null when $values is empty.
	 */
	private static function maximum( array $values ): ?int {
		return $values ? max( $values ) : null;
	}

	/**
	 * Picks the reading fields present on a request into a meta_input-style array.
	 *
	 * @param WP_REST_Request $request Current request.
	 * @return array<string, mixed>
	 */
	private static function collect_meta_input( WP_REST_Request $request ): array {
		$meta = array();

		foreach ( self::META_KEYS as $key ) {
			$value = $request->get_param( $key );

			if ( null !== $value ) {
				$meta[ $key ] = $value;
			}
		}

		return $meta;
	}

	/**
	 * Formats a reading post into the API's public shape.
	 *
	 * Never the raw WP_Post object -- only the fields the API exposes.
	 *
	 * @param WP_Post $post Reading post.
	 * @return array{id: int, reading_datetime: string, systolic: int, diastolic: int, pulse: int|null, weight: float|null, notes: string}
	 */
	private function format_item( WP_Post $post ): array {
		$pulse  = get_post_meta( $post->ID, 'pulse', true );
		$weight = get_post_meta( $post->ID, 'weight', true );

		return array(
			'id'               => $post->ID,
			'reading_datetime' => (string) get_post_meta( $post->ID, 'reading_datetime', true ),
			'systolic'         => (int) get_post_meta( $post->ID, 'systolic', true ),
			'diastolic'        => (int) get_post_meta( $post->ID, 'diastolic', true ),
			'pulse'            => '' === $pulse ? null : (int) $pulse,
			'weight'           => '' === $weight ? null : (float) $weight,
			'notes'            => (string) get_post_meta( $post->ID, 'notes', true ),
		);
	}

	/**
	 * Builds the field schema shared by create (required) and update (optional).
	 *
	 * @param bool $required Whether the core vitals are required.
	 * @return array<string, mixed>
	 */
	private static function item_schema_args( bool $required ): array {
		return array(
			'reading_datetime' => array(
				'required' => $required,
				'type'     => 'string',
				'format'   => 'date-time',
			),
			'systolic'         => array(
				'required' => $required,
				'type'     => 'integer',
				'minimum'  => BP_Tracker_CPT::SYSTOLIC_MIN,
				'maximum'  => BP_Tracker_CPT::SYSTOLIC_MAX,
			),
			'diastolic'        => array(
				'required' => $required,
				'type'     => 'integer',
				'minimum'  => BP_Tracker_CPT::DIASTOLIC_MIN,
				'maximum'  => BP_Tracker_CPT::DIASTOLIC_MAX,
			),
			'pulse'            => array(
				'type'    => 'integer',
				'minimum' => BP_Tracker_CPT::PULSE_MIN,
				'maximum' => BP_Tracker_CPT::PULSE_MAX,
			),
			'weight'           => array(
				'type' => 'number',
			),
			'notes'            => array(
				'type' => 'string',
			),
		);
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

	/**
	 * Builds the standard "not found" REST error.
	 *
	 * @return WP_Error
	 */
	private static function not_found_error(): WP_Error {
		return new WP_Error(
			'bp_tracker_rest_not_found',
			__( 'Reading not found.', 'bp-tracker' ),
			array( 'status' => 404 )
		);
	}
}

BP_Tracker_REST_Controller::init();
