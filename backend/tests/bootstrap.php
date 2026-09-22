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

/**
 * Manually loads the plugin under test.
 */
function bp_tracker_tests_load_plugin(): void {
	require dirname( __DIR__ ) . '/bp-tracker.php';
}
tests_add_filter( 'muplugins_loaded', 'bp_tracker_tests_load_plugin' );

require $bp_tracker_tests_dir . '/includes/bootstrap.php';
