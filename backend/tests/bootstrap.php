<?php
/**
 * PHPUnit bootstrap, wired to the WordPress test library that wp-env
 * provisions inside its "tests-wordpress" / "tests-cli" containers.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

$bp_tracker_tests_dir = getenv( 'WP_TESTS_DIR' );

if ( ! $bp_tracker_tests_dir ) {
	$bp_tracker_tests_dir = '/tmp/wordpress-tests-lib';
}

require_once $bp_tracker_tests_dir . '/includes/functions.php';

// Test values, defined before the plugin loads: existing constants win over
// backend/.env, so the suite never depends on (or reads) a developer's .env.
if ( ! defined( 'BP_TRACKER_JWT_SECRET' ) ) {
	define( 'BP_TRACKER_JWT_SECRET', 'test-secret-do-not-use-in-production' );
}

if ( ! defined( 'BP_TRACKER_FRONTEND_ORIGIN' ) ) {
	define( 'BP_TRACKER_FRONTEND_ORIGIN', 'http://localhost:3000' );
}

/**
 * Manually loads the plugin under test, including its DB schema.
 */
function bp_tracker_tests_load_plugin(): void {
	require dirname( __DIR__ ) . '/bp-tracker.php';

	BP_Tracker_JWT_Auth::create_tables();

	// Activation hooks don't run here: install the roles the same way.
	BP_Tracker_Roles::install();

	// WordPress' test installer doesn't reset plugin tables, so rows left by
	// an interrupted run (or anything that escaped a test's rollback) would
	// leak into this one. Start every run from an empty table.
	global $wpdb;
	$wpdb->query( 'TRUNCATE TABLE ' . BP_Tracker_JWT_Auth::table_name() ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.SchemaChange -- our own table name; test bootstrap only.
}
tests_add_filter( 'muplugins_loaded', 'bp_tracker_tests_load_plugin' );

require $bp_tracker_tests_dir . '/includes/bootstrap.php';
