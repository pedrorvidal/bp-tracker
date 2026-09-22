<?php
/**
 * Registers the "bp_reading" custom post type and its meta fields.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_CPT
 */
class BP_Tracker_CPT {

	/**
	 * Post type slug.
	 *
	 * @var string
	 */
	const POST_TYPE = 'bp_reading';

	/**
	 * Minimum accepted systolic value (mmHg).
	 *
	 * @var int
	 */
	const SYSTOLIC_MIN = 60;

	/**
	 * Maximum accepted systolic value (mmHg).
	 *
	 * @var int
	 */
	const SYSTOLIC_MAX = 250;

	/**
	 * Minimum accepted diastolic value (mmHg).
	 *
	 * @var int
	 */
	const DIASTOLIC_MIN = 40;

	/**
	 * Maximum accepted diastolic value (mmHg).
	 *
	 * @var int
	 */
	const DIASTOLIC_MAX = 150;

	/**
	 * Minimum accepted pulse value (bpm).
	 *
	 * @var int
	 */
	const PULSE_MIN = 30;

	/**
	 * Maximum accepted pulse value (bpm).
	 *
	 * @var int
	 */
	const PULSE_MAX = 220;

	/**
	 * Wires up the post type, its meta fields and their guards.
	 */
	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'register_post_type' ) );
		add_action( 'init', array( __CLASS__, 'register_meta' ) );
		add_action( 'save_post_' . self::POST_TYPE, array( __CLASS__, 'set_reading_title' ), 10, 3 );
		add_filter( 'add_post_metadata', array( __CLASS__, 'validate_meta' ), 10, 5 );
		add_filter( 'update_post_metadata', array( __CLASS__, 'validate_meta' ), 10, 5 );
	}

	/**
	 * Registers the "bp_reading" post type.
	 *
	 * Not public: it exists only to be managed through the REST API by the
	 * plugin's own frontend, not queried or indexed like ordinary content.
	 */
	public static function register_post_type(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'          => __( 'Readings', 'bp-tracker' ),
					'singular_name' => __( 'Reading', 'bp-tracker' ),
				),
				'public'              => false,
				'show_ui'             => true,
				'show_in_menu'        => true,
				'show_in_rest'        => true,
				'rest_base'           => 'bp-readings',
				'supports'            => array( 'title', 'custom-fields' ),
				'capability_type'     => 'post',
				'map_meta_cap'        => true,
				'hierarchical'        => false,
				'has_archive'         => false,
				'rewrite'             => false,
				'query_var'           => false,
				'publicly_queryable'  => false,
				'exclude_from_search' => true,
				'show_in_nav_menus'   => false,
				'show_in_admin_bar'   => false,
			)
		);
	}

	/**
	 * Registers every "bp_reading" meta field.
	 */
	public static function register_meta(): void {
		register_post_meta(
			self::POST_TYPE,
			'reading_datetime',
			array(
				'type'              => 'string',
				'single'            => true,
				'sanitize_callback' => 'sanitize_text_field',
				'auth_callback'     => array( __CLASS__, 'auth_callback' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'   => 'string',
						'format' => 'date-time',
					),
				),
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'systolic',
			array(
				'type'              => 'integer',
				'single'            => true,
				'sanitize_callback' => 'absint',
				'auth_callback'     => array( __CLASS__, 'auth_callback' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'integer',
						'minimum' => self::SYSTOLIC_MIN,
						'maximum' => self::SYSTOLIC_MAX,
					),
				),
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'diastolic',
			array(
				'type'              => 'integer',
				'single'            => true,
				'sanitize_callback' => 'absint',
				'auth_callback'     => array( __CLASS__, 'auth_callback' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'integer',
						'minimum' => self::DIASTOLIC_MIN,
						'maximum' => self::DIASTOLIC_MAX,
					),
				),
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'pulse',
			array(
				'type'              => 'integer',
				'single'            => true,
				'sanitize_callback' => 'absint',
				'auth_callback'     => array( __CLASS__, 'auth_callback' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'    => 'integer',
						'minimum' => self::PULSE_MIN,
						'maximum' => self::PULSE_MAX,
					),
				),
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'weight',
			array(
				'type'              => 'number',
				'single'            => true,
				'sanitize_callback' => array( __CLASS__, 'sanitize_float' ),
				'auth_callback'     => array( __CLASS__, 'auth_callback' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type' => 'number',
					),
				),
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'notes',
			array(
				'type'              => 'string',
				'single'            => true,
				'sanitize_callback' => 'sanitize_text_field',
				'auth_callback'     => array( __CLASS__, 'auth_callback' ),
				'show_in_rest'      => true,
			)
		);
	}

	/**
	 * Casts a raw meta value to float.
	 *
	 * @param mixed $value Raw value coming from the sanitize_meta() call.
	 * @return float
	 */
	public static function sanitize_float( mixed $value ): float {
		return (float) $value;
	}

	/**
	 * Authorizes reading meta reads/writes.
	 *
	 * @param bool   $allowed  Whether the value should be allowed so far.
	 * @param string $meta_key Meta key being checked.
	 * @param int    $post_id  Post ID the meta belongs to.
	 * @param int    $user_id  User requesting the change.
	 * @param string        $cap  Meta capability being checked.
	 * @param array<string> $caps Concrete capabilities being checked.
	 * @return bool
	 */
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- signature is dictated by WordPress' "auth_{$object_type}_meta_{$meta_key}" filter.
	public static function auth_callback( bool $allowed, string $meta_key, int $post_id, int $user_id, string $cap, array $caps ): bool {
		return current_user_can( 'edit_post', $post_id );
	}

	/**
	 * Rejects out-of-range vitals before they are written to the database.
	 *
	 * Hooked to both "add_post_metadata" and "update_post_metadata", so it
	 * guards direct `update_post_meta()`/`add_post_meta()` calls as well as
	 * meta writes coming through the REST API.
	 *
	 * @param mixed  $check      Whether to short-circuit the meta write.
	 * @param int    $object_id  Post ID the meta belongs to.
	 * @param string $meta_key   Meta key being written.
	 * @param mixed  $meta_value Meta value being written.
	 * @param mixed  $extra      Previous value (update) or uniqueness flag (add).
	 * @return mixed
	 */
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- signature must match both "add_post_metadata" and "update_post_metadata".
	public static function validate_meta( mixed $check, int $object_id, string $meta_key, mixed $meta_value, mixed $extra = null ): mixed {
		if ( self::POST_TYPE !== get_post_type( $object_id ) ) {
			return $check;
		}

		switch ( $meta_key ) {
			case 'systolic':
				return self::within_range( $meta_value, self::SYSTOLIC_MIN, self::SYSTOLIC_MAX ) ? $check : false;

			case 'diastolic':
				return self::within_range( $meta_value, self::DIASTOLIC_MIN, self::DIASTOLIC_MAX ) ? $check : false;

			case 'pulse':
				if ( '' === $meta_value || null === $meta_value ) {
					return $check;
				}
				return self::within_range( $meta_value, self::PULSE_MIN, self::PULSE_MAX ) ? $check : false;

			default:
				return $check;
		}
	}

	/**
	 * Checks whether a numeric value falls within an inclusive range.
	 *
	 * @param mixed $value Value to check.
	 * @param int   $min   Inclusive lower bound.
	 * @param int   $max   Inclusive upper bound.
	 * @return bool
	 */
	private static function within_range( mixed $value, int $min, int $max ): bool {
		if ( ! is_numeric( $value ) ) {
			return false;
		}

		$int_value = (int) $value;

		return $int_value >= $min && $int_value <= $max;
	}

	/**
	 * Sets the post title from the reading's vitals on save.
	 *
	 * @param int     $post_id Post ID being saved.
	 * @param WP_Post $post    Post object being saved.
	 * @param bool    $update  Whether this is an existing post being updated.
	 */
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- signature must match the "save_post_{$post_type}" action.
	public static function set_reading_title( int $post_id, WP_Post $post, bool $update ): void {
		if ( wp_is_post_autosave( $post_id ) || wp_is_post_revision( $post_id ) ) {
			return;
		}

		$reading_datetime = get_post_meta( $post_id, 'reading_datetime', true );
		$systolic         = get_post_meta( $post_id, 'systolic', true );
		$diastolic        = get_post_meta( $post_id, 'diastolic', true );

		if ( '' === $reading_datetime || '' === $systolic || '' === $diastolic ) {
			return;
		}

		$title = sprintf( '%s — %dx%d', $reading_datetime, (int) $systolic, (int) $diastolic );

		if ( $post->post_title === $title ) {
			return;
		}

		remove_action( 'save_post_' . self::POST_TYPE, array( __CLASS__, 'set_reading_title' ) );
		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => $title,
			)
		);
		add_action( 'save_post_' . self::POST_TYPE, array( __CLASS__, 'set_reading_title' ), 10, 3 );
	}
}

BP_Tracker_CPT::init();
