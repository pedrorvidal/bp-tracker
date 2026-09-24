<?php
/**
 * Tests for BP_Tracker_Roles and the bp_reading capability mapping.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_Roles_Test
 */
class BP_Tracker_Roles_Test extends WP_UnitTestCase {

	/**
	 * Restores the roles if a test removed or altered them.
	 */
	public function tearDown(): void {
		BP_Tracker_Roles::install();
		wp_set_current_user( 0 );

		parent::tearDown();
	}

	/**
	 * Creates a reading owned by a user.
	 *
	 * @param int $user_id Owner.
	 * @return int Post ID.
	 */
	private function create_reading_for( int $user_id ): int {
		return self::factory()->post->create(
			array(
				'post_type'   => BP_Tracker_CPT::POST_TYPE,
				'post_status' => 'publish',
				'post_author' => $user_id,
				'meta_input'  => array(
					'reading_datetime' => '2026-09-22T08:00:00+00:00',
					'systolic'         => 120,
					'diastolic'        => 80,
				),
			)
		);
	}

	/**
	 * The post type maps its capabilities to its own, plural names.
	 */
	public function test_post_type_uses_its_own_capabilities(): void {
		$cap = get_post_type_object( BP_Tracker_CPT::POST_TYPE )->cap;

		$this->assertSame( 'edit_bp_readings', $cap->edit_posts );
		$this->assertSame( 'edit_others_bp_readings', $cap->edit_others_posts );
		$this->assertSame( 'delete_others_bp_readings', $cap->delete_others_posts );
		$this->assertSame( 'publish_bp_readings', $cap->publish_posts );
		$this->assertSame( 'edit_bp_readings', $cap->create_posts );
		$this->assertTrue( get_post_type_object( BP_Tracker_CPT::POST_TYPE )->map_meta_cap );
	}

	/**
	 * The pending role exists and grants nothing, not even "read".
	 */
	public function test_pending_role_has_no_capabilities(): void {
		$role = get_role( BP_Tracker_Roles::PENDING );

		$this->assertNotNull( $role );
		$this->assertSame( array(), array_filter( $role->capabilities ) );

		$user = self::factory()->user->create_and_get( array( 'role' => BP_Tracker_Roles::PENDING ) );
		$this->assertFalse( user_can( $user, 'read' ) );
		$this->assertFalse( user_can( $user, 'edit_bp_readings' ) );
		$this->assertTrue( BP_Tracker_Roles::is_pending( $user ) );
	}

	/**
	 * The user role holds exactly read + the own-readings capabilities.
	 */
	public function test_user_role_has_exactly_the_own_reading_capabilities(): void {
		$role = get_role( BP_Tracker_Roles::USER );

		$this->assertNotNull( $role );

		$caps = array_keys( array_filter( $role->capabilities ) );
		sort( $caps );
		$expected = array(
			'delete_bp_readings',
			'delete_published_bp_readings',
			'edit_bp_readings',
			'edit_published_bp_readings',
			'publish_bp_readings',
			'read',
		);

		$this->assertSame( $expected, $caps );
	}

	/**
	 * A bp_tracker_user can never act on someone else's readings.
	 */
	public function test_bp_tracker_user_lacks_others_capabilities(): void {
		$user_id  = self::factory()->user->create( array( 'role' => BP_Tracker_Roles::USER ) );
		$other_id = self::factory()->user->create( array( 'role' => BP_Tracker_Roles::USER ) );
		$user     = get_userdata( $user_id );

		$this->assertFalse( user_can( $user, 'edit_others_bp_readings' ) );
		$this->assertFalse( user_can( $user, 'delete_others_bp_readings' ) );
		$this->assertFalse( BP_Tracker_Roles::is_pending( $user ) );

		$own    = $this->create_reading_for( $user_id );
		$others = $this->create_reading_for( $other_id );

		$this->assertTrue( user_can( $user, 'edit_post', $own ) );
		$this->assertTrue( user_can( $user, 'delete_post', $own ) );
		$this->assertFalse( user_can( $user, 'edit_post', $others ) );
		$this->assertFalse( user_can( $user, 'delete_post', $others ) );
	}

	/**
	 * Generic post capabilities no longer reach readings: an author (who can
	 * edit posts) can't edit a reading, not even their own.
	 */
	public function test_generic_post_roles_get_no_reading_capabilities(): void {
		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		$reading   = $this->create_reading_for( $author_id );

		$this->assertTrue( user_can( $author_id, 'edit_posts' ) );
		$this->assertFalse( user_can( $author_id, 'edit_bp_readings' ) );
		$this->assertFalse( user_can( $author_id, 'edit_post', $reading ) );
	}

	/**
	 * Administrators get the own-reading capabilities, not the others' ones.
	 */
	public function test_administrator_gets_the_reading_capabilities(): void {
		$admin = get_role( 'administrator' );

		foreach ( BP_Tracker_Roles::READING_CAPS as $cap ) {
			$this->assertTrue( $admin->has_cap( $cap ), $cap );
		}

		$this->assertFalse( $admin->has_cap( 'edit_others_bp_readings' ) );
		$this->assertFalse( $admin->has_cap( 'delete_others_bp_readings' ) );
	}

	/**
	 * Deactivation removes both roles and the administrators' capabilities.
	 */
	public function test_uninstall_removes_roles_and_admin_capabilities(): void {
		BP_Tracker_Roles::uninstall();

		$this->assertNull( get_role( BP_Tracker_Roles::PENDING ) );
		$this->assertNull( get_role( BP_Tracker_Roles::USER ) );
		$this->assertFalse( get_role( 'administrator' )->has_cap( 'edit_bp_readings' ) );
		$this->assertFalse( get_option( BP_Tracker_Roles::VERSION_OPTION ) );
	}

	/**
	 * On a site where the plugin was already active, maybe_upgrade() installs
	 * the roles and syncs a role that drifted (e.g. edited by hand).
	 */
	public function test_maybe_upgrade_installs_and_syncs_roles(): void {
		BP_Tracker_Roles::uninstall();
		BP_Tracker_Roles::maybe_upgrade();

		$this->assertNotNull( get_role( BP_Tracker_Roles::PENDING ) );
		$this->assertNotNull( get_role( BP_Tracker_Roles::USER ) );
		$this->assertSame( BP_Tracker_Roles::VERSION, get_option( BP_Tracker_Roles::VERSION_OPTION ) );

		get_role( BP_Tracker_Roles::USER )->add_cap( 'edit_others_bp_readings' );
		get_role( BP_Tracker_Roles::PENDING )->add_cap( 'read' );
		update_option( BP_Tracker_Roles::VERSION_OPTION, '0.0.0' );

		BP_Tracker_Roles::maybe_upgrade();

		$this->assertFalse( get_role( BP_Tracker_Roles::USER )->has_cap( 'edit_others_bp_readings' ) );
		$this->assertFalse( get_role( BP_Tracker_Roles::PENDING )->has_cap( 'read' ) );
	}

	/**
	 * Making an approved user pending again ends all of their sessions.
	 */
	public function test_demoting_to_pending_revokes_sessions(): void {
		$user_id = self::factory()->user->create( array( 'role' => BP_Tracker_Roles::USER ) );
		$before  = BP_Tracker_Sessions::generation( $user_id );

		get_userdata( $user_id )->set_role( BP_Tracker_Roles::PENDING );

		$this->assertSame( $before + 1, BP_Tracker_Sessions::generation( $user_id ) );
	}

	/**
	 * Adding the pending role on top of another one revokes sessions too.
	 */
	public function test_adding_the_pending_role_revokes_sessions(): void {
		$user_id = self::factory()->user->create( array( 'role' => BP_Tracker_Roles::USER ) );
		$before  = BP_Tracker_Sessions::generation( $user_id );

		get_userdata( $user_id )->add_role( BP_Tracker_Roles::PENDING );

		$this->assertSame( $before + 1, BP_Tracker_Sessions::generation( $user_id ) );
		$this->assertTrue( BP_Tracker_Roles::is_pending( get_userdata( $user_id ) ) );
	}

	/**
	 * Approving a user (pending -> user) doesn't touch their sessions.
	 */
	public function test_approving_a_user_keeps_sessions(): void {
		$user_id = self::factory()->user->create( array( 'role' => BP_Tracker_Roles::PENDING ) );
		$before  = BP_Tracker_Sessions::generation( $user_id );

		get_userdata( $user_id )->set_role( BP_Tracker_Roles::USER );

		$this->assertSame( $before, BP_Tracker_Sessions::generation( $user_id ) );
	}
}
