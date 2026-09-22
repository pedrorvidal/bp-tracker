<?php
/**
 * Plugin Name:       BP Tracker
 * Description:       Blood pressure tracking plugin.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      8.2
 * Author:            Pedro Vidal
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       bp-tracker
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'BP_TRACKER_VERSION', '0.1.0' );
define( 'BP_TRACKER_FILE', __FILE__ );
define( 'BP_TRACKER_DIR', plugin_dir_path( __FILE__ ) );
define( 'BP_TRACKER_URL', plugin_dir_url( __FILE__ ) );

/**
 * Loads every PHP file under includes/.
 */
function bp_tracker_load_includes(): void {
	$files = glob( BP_TRACKER_DIR . 'includes/*.php' );

	foreach ( false === $files ? array() : $files as $file ) {
		require_once $file;
	}
}
bp_tracker_load_includes();
