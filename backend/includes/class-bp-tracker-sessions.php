<?php
/**
 * Session revocation and refresh token housekeeping.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BP_Tracker_Sessions
 *
 * - Revokes every session of a user when their password changes, or on
 *   demand ("sign out of all devices").
 * - Deletes the refresh tokens of deleted users.
 * - Purges expired refresh tokens daily via WP-Cron.
 */
class BP_Tracker_Sessions {

	/**
	 * User meta holding the user's session generation.
	 *
	 * Every access token carries the generation it was issued under ("gen"
	 * claim); revoke_all() increments it, so every token issued before is
	 * rejected at once, even if it hasn't expired. A counter, not a
	 * timestamp: no clock or same-second ambiguity.
	 *
	 * @var string
	 */
	const GENERATION_META = 'bp_tracker_session_generation';

	/**
	 * WP-Cron hook that purges expired refresh tokens.
	 *
	 * @var string
	 */
	const PURGE_HOOK = 'bp_tracker_purge_expired_refresh_tokens';

	/**
	 * Wires up the password-change, user-deletion and cron hooks.
	 */
	public static function init(): void {
		add_action( 'wp_set_password', array( __CLASS__, 'revoke_on_set_password' ), 10, 2 );
		add_action( 'profile_update', array( __CLASS__, 'revoke_on_password_change' ), 10, 2 );
		add_action( 'deleted_user', array( __CLASS__, 'delete_user_tokens' ) );
		add_action( self::PURGE_HOOK, array( __CLASS__, 'purge_expired' ) );
		add_action( 'init', array( __CLASS__, 'schedule_purge' ) );
		register_deactivation_hook( BP_TRACKER_FILE, array( __CLASS__, 'unschedule_purge' ) );
	}

	/**
	 * Revokes all sessions of a user: deletes their refresh tokens and bumps
	 * their session generation, invalidating every access token issued so far.
	 *
	 * @param int $user_id User ID.
	 * @return int Number of refresh tokens deleted.
	 */
	public static function revoke_all( int $user_id ): int {
		global $wpdb;

		update_user_meta( $user_id, self::GENERATION_META, self::generation( $user_id ) + 1 );

		return (int) $wpdb->delete( BP_Tracker_JWT_Auth::table_name(), array( 'user_id' => $user_id ), array( '%d' ) );
	}

	/**
	 * The user's current session generation (0 until the first revocation).
	 *
	 * @param int $user_id User ID.
	 * @return int
	 */
	public static function generation( int $user_id ): int {
		return (int) get_user_meta( $user_id, self::GENERATION_META, true );
	}

	/**
	 * Revokes a user's sessions when wp_set_password() changes their password
	 * (password resets, and WP-CLI / plugins that set passwords directly).
	 *
	 * @param string $password New password (unused).
	 * @param int    $user_id  User ID.
	 */
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundBeforeLastUsed -- signature must match the "wp_set_password" action.
	public static function revoke_on_set_password( string $password, int $user_id ): void {
		self::revoke_all( $user_id );
	}

	/**
	 * Revokes a user's sessions when a profile update changed the password
	 * (e.g. wp_update_user() with a new user_pass, as the profile screen does).
	 *
	 * @param int     $user_id       User ID.
	 * @param WP_User $old_user_data User data before the update.
	 */
	public static function revoke_on_password_change( int $user_id, WP_User $old_user_data ): void {
		$user = get_userdata( $user_id );

		if ( false !== $user && $user->user_pass !== $old_user_data->user_pass ) {
			self::revoke_all( $user_id );
		}
	}

	/**
	 * Deletes the refresh tokens of a user who was deleted.
	 *
	 * @param int $user_id Deleted user's ID.
	 */
	public static function delete_user_tokens( int $user_id ): void {
		global $wpdb;

		$wpdb->delete( BP_Tracker_JWT_Auth::table_name(), array( 'user_id' => $user_id ), array( '%d' ) );
	}

	/**
	 * Deletes expired refresh tokens (daily WP-Cron job).
	 */
	public static function purge_expired(): void {
		global $wpdb;

		$table = BP_Tracker_JWT_Auth::table_name();

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table is our own prefixed table name, never user input; wpdb::prepare() cannot placeholder identifiers.
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE expires_at < %s", gmdate( 'Y-m-d H:i:s' ) ) );
	}

	/**
	 * Schedules the daily purge if it isn't scheduled yet.
	 */
	public static function schedule_purge(): void {
		if ( false === wp_next_scheduled( self::PURGE_HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::PURGE_HOOK );
		}
	}

	/**
	 * Removes the daily purge (plugin deactivation).
	 */
	public static function unschedule_purge(): void {
		wp_clear_scheduled_hook( self::PURGE_HOOK );
	}
}

BP_Tracker_Sessions::init();
