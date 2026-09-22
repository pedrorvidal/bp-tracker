<?php
/**
 * Tests for BP_Tracker_REST_Controller.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_REST_Controller_Test
 */
class BP_Tracker_REST_Controller_Test extends WP_UnitTestCase {

	/**
	 * A default test user, owner of readings created without an explicit author.
	 *
	 * @var int
	 */
	private int $user_id;

	/**
	 * Creates a default test user.
	 */
	public function setUp(): void {
		parent::setUp();

		$this->user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
	}

	/**
	 * Resets the current user between tests.
	 */
	public function tearDown(): void {
		wp_set_current_user( 0 );

		parent::tearDown();
	}

	/**
	 * Creates a reading post owned by the given user.
	 *
	 * @param int   $user_id  Owner.
	 * @param array $overrides Meta overrides.
	 * @return int Post ID.
	 */
	private function create_reading_for( int $user_id, array $overrides = array() ): int {
		$defaults = array(
			'reading_datetime' => '2026-09-22T08:00:00+00:00',
			'systolic'         => 120,
			'diastolic'        => 80,
		);

		return self::factory()->post->create(
			array(
				'post_type'   => BP_Tracker_CPT::POST_TYPE,
				'post_status' => 'publish',
				'post_author' => $user_id,
				'meta_input'  => array_merge( $defaults, $overrides ),
			)
		);
	}

	/**
	 * Dispatches a REST request and returns its response.
	 *
	 * @param string $method HTTP method.
	 * @param string $route  Route, including leading slash.
	 * @param array  $params Body/query params.
	 * @return WP_REST_Response
	 */
	private function dispatch( string $method, string $route, array $params = array() ): WP_REST_Response {
		$request = new WP_REST_Request( $method, $route );

		foreach ( $params as $key => $value ) {
			$request->set_param( $key, $value );
		}

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * A full create/read/update/delete cycle for the authenticated owner.
	 */
	public function test_full_crud_cycle_for_authenticated_owner(): void {
		wp_set_current_user( $this->user_id );

		$create = $this->dispatch(
			'POST',
			'/bp-tracker/v1/readings',
			array(
				'reading_datetime' => '2026-09-22T08:30:00+00:00',
				'systolic'         => 118,
				'diastolic'        => 76,
				'pulse'            => 65,
				'weight'           => 72.5,
				'notes'            => 'Before breakfast',
			)
		);

		$this->assertSame( 201, $create->get_status() );
		$body = $create->get_data();
		$this->assertSame( '2026-09-22T08:30:00+00:00', $body['reading_datetime'] );
		$this->assertSame( 118, $body['systolic'] );
		$this->assertSame( 76, $body['diastolic'] );
		$this->assertSame( 65, $body['pulse'] );
		$this->assertEqualsWithDelta( 72.5, $body['weight'], 0.01 );
		$this->assertSame( 'Before breakfast', $body['notes'] );
		$this->assertSame( array( 'id', 'reading_datetime', 'systolic', 'diastolic', 'pulse', 'weight', 'notes' ), array_keys( $body ) );

		$id = $body['id'];

		$read = $this->dispatch( 'GET', '/bp-tracker/v1/readings/' . $id );
		$this->assertSame( 200, $read->get_status() );
		$this->assertSame( 118, $read->get_data()['systolic'] );

		$update = $this->dispatch( 'PUT', '/bp-tracker/v1/readings/' . $id, array( 'systolic' => 122 ) );
		$this->assertSame( 200, $update->get_status() );
		$this->assertSame( 122, $update->get_data()['systolic'] );
		$this->assertSame( 76, $update->get_data()['diastolic'] );

		$delete = $this->dispatch( 'DELETE', '/bp-tracker/v1/readings/' . $id );
		$this->assertSame( 200, $delete->get_status() );
		$this->assertTrue( $delete->get_data()['deleted'] );

		$after_delete = $this->dispatch( 'GET', '/bp-tracker/v1/readings/' . $id );
		$this->assertSame( 404, $after_delete->get_status() );
	}

	/**
	 * Every route rejects an anonymous (logged-out) caller.
	 */
	public function test_anonymous_is_rejected_on_every_route(): void {
		$id = $this->create_reading_for( $this->user_id );

		$this->assertSame( 401, $this->dispatch( 'GET', '/bp-tracker/v1/readings' )->get_status() );
		$this->assertSame(
			401,
			$this->dispatch(
				'POST',
				'/bp-tracker/v1/readings',
				array(
					'reading_datetime' => '2026-01-01T00:00:00+00:00',
					'systolic'         => 120,
					'diastolic'        => 80,
				)
			)->get_status()
		);
		$this->assertSame( 401, $this->dispatch( 'GET', '/bp-tracker/v1/readings/' . $id )->get_status() );
		$this->assertSame( 401, $this->dispatch( 'PUT', '/bp-tracker/v1/readings/' . $id, array( 'systolic' => 100 ) )->get_status() );
		$this->assertSame( 401, $this->dispatch( 'DELETE', '/bp-tracker/v1/readings/' . $id )->get_status() );
		$this->assertSame( 401, $this->dispatch( 'GET', '/bp-tracker/v1/stats' )->get_status() );
	}

	/**
	 * A user cannot read, edit or delete another user's reading.
	 */
	public function test_user_cannot_access_another_users_reading(): void {
		$other_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$id       = $this->create_reading_for( $this->user_id );

		wp_set_current_user( $other_id );

		$this->assertSame( 403, $this->dispatch( 'GET', '/bp-tracker/v1/readings/' . $id )->get_status() );
		$this->assertSame( 403, $this->dispatch( 'PUT', '/bp-tracker/v1/readings/' . $id, array( 'systolic' => 100 ) )->get_status() );
		$this->assertSame( 403, $this->dispatch( 'DELETE', '/bp-tracker/v1/readings/' . $id )->get_status() );

		// Untouched by the rejected attempts.
		$this->assertSame( 120, (int) get_post_meta( $id, 'systolic', true ) );
		$this->assertSame( 'publish', get_post_status( $id ) );
	}

	/**
	 * The collection only ever returns the current user's own readings.
	 */
	public function test_collection_only_returns_current_users_readings(): void {
		$other_id = self::factory()->user->create( array( 'role' => 'administrator' ) );

		$own_id        = $this->create_reading_for( $this->user_id );
		$other_id_post = $this->create_reading_for( $other_id );

		wp_set_current_user( $this->user_id );

		$response = $this->dispatch( 'GET', '/bp-tracker/v1/readings' );
		$ids      = wp_list_pluck( $response->get_data(), 'id' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertContains( $own_id, $ids );
		$this->assertNotContains( $other_id_post, $ids );
	}

	/**
	 * per_page/page slice the collection, and X-WP-Total(Pages) reflect it.
	 */
	public function test_collection_is_paginated(): void {
		wp_set_current_user( $this->user_id );

		for ( $day = 1; $day <= 5; $day++ ) {
			$this->create_reading_for( $this->user_id, array( 'reading_datetime' => sprintf( '2026-09-%02dT08:00:00+00:00', $day ) ) );
		}

		$response = $this->dispatch(
			'GET',
			'/bp-tracker/v1/readings',
			array(
				'per_page' => 2,
				'page'     => 2,
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertCount( 2, $response->get_data() );
		$this->assertSame( '5', $response->get_headers()['X-WP-Total'] );
		$this->assertSame( '3', $response->get_headers()['X-WP-TotalPages'] );
	}

	/**
	 * Creating a reading with an out-of-range value is rejected with 400.
	 */
	public function test_create_rejects_out_of_range_payload(): void {
		wp_set_current_user( $this->user_id );

		$response = $this->dispatch(
			'POST',
			'/bp-tracker/v1/readings',
			array(
				'reading_datetime' => '2026-09-22T08:30:00+00:00',
				'systolic'         => BP_Tracker_CPT::SYSTOLIC_MAX + 1,
				'diastolic'        => 80,
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'rest_invalid_param', $response->get_data()['code'] );
	}

	/**
	 * Updating a reading with an out-of-range value is rejected and the
	 * stored value is left untouched.
	 */
	public function test_update_rejects_out_of_range_payload(): void {
		wp_set_current_user( $this->user_id );
		$id = $this->create_reading_for( $this->user_id );

		$response = $this->dispatch( 'PUT', '/bp-tracker/v1/readings/' . $id, array( 'diastolic' => BP_Tracker_CPT::DIASTOLIC_MIN - 1 ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 80, (int) get_post_meta( $id, 'diastolic', true ) );
	}

	/**
	 * /stats returns correct averages/count for known data, scoped to the
	 * current user and the requested period.
	 */
	public function test_stats_returns_correct_averages_for_known_data(): void {
		wp_set_current_user( $this->user_id );

		$this->create_reading_for(
			$this->user_id,
			array(
				'reading_datetime' => '2026-09-01T08:00:00+00:00',
				'systolic'         => 110,
				'diastolic'        => 70,
				'pulse'            => 60,
			)
		);
		$this->create_reading_for(
			$this->user_id,
			array(
				'reading_datetime' => '2026-09-10T08:00:00+00:00',
				'systolic'         => 130,
				'diastolic'        => 90,
				'pulse'            => 80,
			)
		);
		$this->create_reading_for(
			$this->user_id,
			array(
				'reading_datetime' => '2026-09-20T08:00:00+00:00',
				'systolic'         => 120,
				'diastolic'        => 80,
			)
		);
		// Outside the requested period -- must not affect the averages.
		$this->create_reading_for(
			$this->user_id,
			array(
				'reading_datetime' => '2026-08-01T08:00:00+00:00',
				'systolic'         => 200,
				'diastolic'        => 140,
				'pulse'            => 150,
			)
		);
		// Belongs to another user -- must never be counted.
		$other_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->create_reading_for(
			$other_id,
			array(
				'reading_datetime' => '2026-09-15T08:00:00+00:00',
				'systolic'         => 125,
				'diastolic'        => 85,
			)
		);

		$response = $this->dispatch(
			'GET',
			'/bp-tracker/v1/stats',
			array(
				'period_start' => '2026-09-01T00:00:00+00:00',
				'period_end'   => '2026-09-30T23:59:59+00:00',
			)
		);
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 3, $data['count'] );
		$this->assertEqualsWithDelta( 120.0, $data['systolic_average'], 0.01 );
		$this->assertEqualsWithDelta( 80.0, $data['diastolic_average'], 0.01 );
		$this->assertEqualsWithDelta( 70.0, $data['pulse_average'], 0.01 );
	}
}
