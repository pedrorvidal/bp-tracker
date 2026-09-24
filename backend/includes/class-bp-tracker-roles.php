<?php
/**
 * Roles and capabilities for the bp_reading post type.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_Roles
 *
 * - bp_tracker_pending: new sign-ups. No capabilities at all, and blocked at
 *   login until an administrator approves them (changes their role).
 * - bp_tracker_user: approved users. Can create, edit and delete their own
 *   readings, never anyone else's.
 */
class BP_Tracker_Roles {

	/**
	 * Role of accounts waiting for approval.
	 *
	 * @var string
	 */
	const PENDING = 'bp_tracker_pending';

	/**
	 * Role of approved accounts.
	 *
	 * @var string
	 */
	const USER = 'bp_tracker_user';

	/**
	 * Capabilities granted to approved users (and administrators).
	 *
	 * Deliberately without edit_others_bp_readings / delete_others_bp_readings:
	 * nobody gets access to someone else's readings through capabilities.
	 *
	 * @var string[]
	 */
	const READING_CAPS = array(
		'edit_bp_readings',
		'edit_published_bp_readings',
		'publish_bp_readings',
		'delete_bp_readings',
		'delete_published_bp_readings',
	);

	/**
	 * Bump whenever the roles or their capabilities change, so
	 * maybe_upgrade() re-syncs them on sites where the plugin is already active.
	 *
	 * @var string
	 */
	const VERSION = '1.0.0';

	/**
	 * Option storing the installed roles version.
	 *
	 * @var string
	 */
	const VERSION_OPTION = 'bp_tracker_roles_version';

	/**
	 * Wires up installation, removal and session revocation on demotion.
	 */
	public static function init(): void {
		register_activation_hook( BP_TRACKER_FILE, array( __CLASS__, 'install' ) );
		register_deactivation_hook( BP_TRACKER_FILE, array( __CLASS__, 'uninstall' ) );
		add_action( 'plugins_loaded', array( __CLASS__, 'maybe_upgrade' ) );
		// Fired by both WP_User::set_role() and WP_User::add_role().
		add_action( 'add_user_role', array( __CLASS__, 'revoke_if_pending' ), 10, 2 );
	}

	/**
	 * Installs the roles if their version changed.
	 *
	 * Activating an already active plugin is a no-op in WordPress, so the
	 * activation hook alone misses sites that were running an older version.
	 */
	public static function maybe_upgrade(): void {
		if ( get_option( self::VERSION_OPTION ) !== self::VERSION ) {
			self::install();
		}
	}

	/**
	 * Creates both roles and grants administrators the reading capabilities.
	 *
	 * Existing roles are synced to the expected capabilities, so a role
	 * edited by hand (or by an older version) can't keep extra ones.
	 */
	public static function install(): void {
		// Stored untranslated, like core's roles: this can run on
		// plugins_loaded, before translations may load, and the stored name
		// must not depend on the language of whoever triggered the install.
		self::sync_role( self::PENDING, 'BP Tracker: pending approval', array() );
		self::sync_role( self::USER, 'BP Tracker: user', array_merge( array( 'read' ), self::READING_CAPS ) );

		$administrator = get_role( 'administrator' );

		if ( null !== $administrator ) {
			foreach ( self::READING_CAPS as $cap ) {
				$administrator->add_cap( $cap );
			}
		}

		update_option( self::VERSION_OPTION, self::VERSION );
	}

	/**
	 * Removes both roles and the administrators' reading capabilities.
	 *
	 * Users keep the role name in their meta, so reactivating the plugin
	 * restores their access.
	 */
	public static function uninstall(): void {
		remove_role( self::PENDING );
		remove_role( self::USER );

		$administrator = get_role( 'administrator' );

		if ( null !== $administrator ) {
			foreach ( self::READING_CAPS as $cap ) {
				$administrator->remove_cap( $cap );
			}
		}

		delete_option( self::VERSION_OPTION );
	}

	/**
	 * Whether a user is waiting for approval.
	 *
	 * @param WP_User $user User to check.
	 * @return bool
	 */
	public static function is_pending( WP_User $user ): bool {
		return in_array( self::PENDING, $user->roles, true );
	}

	/**
	 * Ends every session of a user who was (re)made pending: a demoted user
	 * must not keep using tokens issued while they were approved.
	 *
	 * @param int    $user_id User who got a role.
	 * @param string $role    The role they got.
	 */
	public static function revoke_if_pending( int $user_id, string $role ): void {
		if ( self::PENDING === $role ) {
			BP_Tracker_Sessions::revoke_all( $user_id );
		}
	}

	/**
	 * Creates a role, or makes an existing one hold exactly $caps.
	 *
	 * @param string   $role         Role name.
	 * @param string   $display_name Human-readable name.
	 * @param string[] $caps         Capabilities the role must have.
	 */
	private static function sync_role( string $role, string $display_name, array $caps ): void {
		$existing = get_role( $role );

		if ( null === $existing ) {
			add_role( $role, $display_name, array_fill_keys( $caps, true ) );
			return;
		}

		foreach ( array_keys( $existing->capabilities ) as $cap ) {
			if ( ! in_array( $cap, $caps, true ) ) {
				$existing->remove_cap( $cap );
			}
		}

		foreach ( $caps as $cap ) {
			$existing->add_cap( $cap );
		}
	}
}

BP_Tracker_Roles::init();
