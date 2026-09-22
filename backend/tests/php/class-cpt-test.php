<?php
/**
 * Tests for BP_Tracker_CPT.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_CPT_Test
 */
class BP_Tracker_CPT_Test extends WP_UnitTestCase {

	/**
	 * WP core's test framework wipes the meta key registry before every
	 * test (it only re-runs "init" once, for the whole suite), so it has
	 * to be re-registered here to test anything registry-dependent.
	 */
	public function setUp(): void {
		parent::setUp();

		BP_Tracker_CPT::register_meta();
	}

	/**
	 * Creates a reading post with the given meta already attached.
	 *
	 * @param array $meta Meta key/value pairs.
	 * @return int Post ID.
	 */
	private function create_reading( array $meta = array() ): int {
		$defaults = array(
			'reading_datetime' => '2026-09-22T08:30:00+00:00',
			'systolic'         => 120,
			'diastolic'        => 80,
		);

		return self::factory()->post->create(
			array(
				'post_type'  => BP_Tracker_CPT::POST_TYPE,
				'meta_input' => array_merge( $defaults, $meta ),
			)
		);
	}

	/**
	 * The post type is registered with the expected visibility and REST wiring.
	 */
	public function test_post_type_is_registered_correctly(): void {
		$this->assertTrue( post_type_exists( BP_Tracker_CPT::POST_TYPE ) );

		$post_type = get_post_type_object( BP_Tracker_CPT::POST_TYPE );

		$this->assertNotNull( $post_type );
		$this->assertFalse( $post_type->public );
		$this->assertFalse( $post_type->publicly_queryable );
		$this->assertTrue( $post_type->show_in_rest );
		$this->assertSame( 'bp-readings', $post_type->rest_base );
	}

	/**
	 * Meta fields are registered with show_in_rest for the post type.
	 */
	public function test_meta_fields_are_registered_for_rest(): void {
		$meta_keys = array( 'reading_datetime', 'systolic', 'diastolic', 'pulse', 'weight', 'notes' );

		$registered = get_registered_meta_keys( 'post', BP_Tracker_CPT::POST_TYPE );

		foreach ( $meta_keys as $meta_key ) {
			$this->assertArrayHasKey( $meta_key, $registered, "Meta key '{$meta_key}' should be registered." );
			$this->assertNotFalse( $registered[ $meta_key ]['show_in_rest'], "Meta key '{$meta_key}' should be exposed via REST." );
		}
	}

	/**
	 * Systolic and diastolic values within range are accepted.
	 */
	public function test_meta_within_range_is_accepted(): void {
		$post_id = $this->create_reading();

		// update_post_meta() returns the new meta ID (not `true`) the first
		// time a key is set, and `false` on a genuine no-op, so assert
		// against `false` rather than strict-comparing to `true`.
		$this->assertNotFalse( update_post_meta( $post_id, 'systolic', 130 ) );
		$this->assertNotFalse( update_post_meta( $post_id, 'diastolic', 85 ) );
		$this->assertNotFalse( update_post_meta( $post_id, 'pulse', 70 ) );

		$this->assertSame( 130, (int) get_post_meta( $post_id, 'systolic', true ) );
		$this->assertSame( 85, (int) get_post_meta( $post_id, 'diastolic', true ) );
		$this->assertSame( 70, (int) get_post_meta( $post_id, 'pulse', true ) );
	}

	/**
	 * Boundary values (inclusive) are accepted for systolic and diastolic.
	 */
	public function test_meta_boundary_values_are_accepted(): void {
		$post_id = $this->create_reading();

		$this->assertTrue( update_post_meta( $post_id, 'systolic', BP_Tracker_CPT::SYSTOLIC_MIN ) );
		$this->assertTrue( update_post_meta( $post_id, 'systolic', BP_Tracker_CPT::SYSTOLIC_MAX ) );
		$this->assertTrue( update_post_meta( $post_id, 'diastolic', BP_Tracker_CPT::DIASTOLIC_MIN ) );
		$this->assertTrue( update_post_meta( $post_id, 'diastolic', BP_Tracker_CPT::DIASTOLIC_MAX ) );
	}

	/**
	 * Out-of-range systolic values are rejected and never persisted.
	 */
	public function test_systolic_out_of_range_is_rejected(): void {
		$post_id = $this->create_reading();

		$this->assertFalse( update_post_meta( $post_id, 'systolic', BP_Tracker_CPT::SYSTOLIC_MIN - 1 ) );
		$this->assertFalse( update_post_meta( $post_id, 'systolic', BP_Tracker_CPT::SYSTOLIC_MAX + 1 ) );

		// The value from create_reading() (120) must remain untouched.
		$this->assertSame( 120, (int) get_post_meta( $post_id, 'systolic', true ) );
	}

	/**
	 * Out-of-range diastolic values are rejected and never persisted.
	 */
	public function test_diastolic_out_of_range_is_rejected(): void {
		$post_id = $this->create_reading();

		$this->assertFalse( update_post_meta( $post_id, 'diastolic', BP_Tracker_CPT::DIASTOLIC_MIN - 1 ) );
		$this->assertFalse( update_post_meta( $post_id, 'diastolic', BP_Tracker_CPT::DIASTOLIC_MAX + 1 ) );

		// The value from create_reading() (80) must remain untouched.
		$this->assertSame( 80, (int) get_post_meta( $post_id, 'diastolic', true ) );
	}

	/**
	 * Out-of-range pulse values are rejected, but the field stays optional.
	 */
	public function test_pulse_out_of_range_is_rejected_but_optional(): void {
		$post_id = $this->create_reading();

		$this->assertFalse( update_post_meta( $post_id, 'pulse', BP_Tracker_CPT::PULSE_MAX + 1 ) );
		$this->assertSame( '', get_post_meta( $post_id, 'pulse', true ) );
	}

	/**
	 * The title is generated from the reading's vitals on save.
	 */
	public function test_title_is_generated_from_vitals(): void {
		$post_id = $this->create_reading(
			array(
				'reading_datetime' => '2026-09-22T08:30:00+00:00',
				'systolic'         => 118,
				'diastolic'        => 76,
			)
		);

		$post = get_post( $post_id );

		$this->assertSame( '2026-09-22T08:30:00+00:00 — 118x76', $post->post_title );
	}

	/**
	 * Reading meta is exposed through the CPT's REST endpoint.
	 */
	public function test_meta_appears_in_rest_api(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$post_id = $this->create_reading(
			array(
				'reading_datetime' => '2026-09-22T08:30:00+00:00',
				'systolic'         => 130,
				'diastolic'        => 85,
				'pulse'            => 72,
			)
		);

		$request  = new WP_REST_Request( 'GET', '/wp/v2/bp-readings/' . $post_id );
		$response = rest_get_server()->dispatch( $request );
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertArrayHasKey( 'meta', $data );
		$this->assertSame( '2026-09-22T08:30:00+00:00', $data['meta']['reading_datetime'] );
		$this->assertSame( 130, $data['meta']['systolic'] );
		$this->assertSame( 85, $data['meta']['diastolic'] );
		$this->assertSame( 72, $data['meta']['pulse'] );
	}
}
