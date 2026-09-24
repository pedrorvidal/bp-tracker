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
 * Minimum JWT secret length, in bytes: HS256 needs a 256-bit key.
 */
define( 'BP_TRACKER_JWT_SECRET_MIN_BYTES', 32 );

// The autoloader provides Dotenv, so it has to come first.
if ( file_exists( BP_TRACKER_DIR . 'vendor/autoload.php' ) ) {
	require_once BP_TRACKER_DIR . 'vendor/autoload.php';
}

/**
 * Loads a .env file from a directory, if there is one.
 *
 * Immutable: variables already set in the real environment are never
 * overridden by the file. Values land in $_ENV (not putenv(), so they don't
 * leak into the environment of child processes).
 *
 * @param string $dir Directory holding the .env file.
 */
function bp_tracker_load_env_file( string $dir ): void {
	if ( class_exists( Dotenv\Dotenv::class ) ) {
		Dotenv\Dotenv::createImmutable( $dir )->safeLoad();
	}
}

/**
 * Reads a configuration value from the environment.
 *
 * A real environment variable (getenv(): server, container or CI) wins over
 * the .env file ($_ENV, filled by bp_tracker_load_env_file()). Empty values
 * count as unset.
 *
 * @param string $name Variable name.
 * @return string|null
 */
function bp_tracker_env( string $name ): ?string {
	$value = getenv( $name );

	if ( ! is_string( $value ) || '' === trim( $value ) ) {
		$value = $_ENV[ $name ] ?? null;
	}

	return is_string( $value ) && '' !== trim( $value ) ? $value : null;
}

/**
 * Defines a constant from the environment, unless it is already defined
 * (e.g. in wp-config.php, which always takes precedence).
 *
 * @param string $name Constant (and environment variable) name.
 */
function bp_tracker_define_from_env( string $name ): void {
	// Only the plugin's own, prefixed constants can be defined this way.
	if ( ! str_starts_with( $name, 'BP_TRACKER_' ) || defined( $name ) ) {
		return;
	}

	$value = bp_tracker_env( $name );

	if ( null !== $value ) {
		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.VariableConstantNameFound -- the BP_TRACKER_ prefix is enforced above; the sniff can't see through the variable.
		define( $name, $value );
	}
}

/**
 * Explains what's wrong with a JWT secret, if anything.
 *
 * @param mixed $secret The configured secret (null when not configured).
 * @return string|null Error message, or null when the secret is usable.
 */
function bp_tracker_jwt_secret_error( mixed $secret ): ?string {
	if ( ! is_string( $secret ) || '' === trim( $secret ) ) {
		return __( 'BP_TRACKER_JWT_SECRET is not set. Copy backend/.env.example to backend/.env and set it (e.g. openssl rand -base64 48), or define it in wp-config.php.', 'bp-tracker' );
	}

	if ( strlen( $secret ) < BP_TRACKER_JWT_SECRET_MIN_BYTES ) {
		return sprintf(
			/* translators: %d: minimum number of bytes. */
			__( 'BP_TRACKER_JWT_SECRET is too short: use at least %d bytes (e.g. openssl rand -base64 48).', 'bp-tracker' ),
			BP_TRACKER_JWT_SECRET_MIN_BYTES
		);
	}

	return null;
}

/**
 * Refuses to activate the plugin without a usable JWT secret.
 *
 * Registered before any other activation callback, so nothing (e.g. table
 * creation) runs when the configuration is incomplete.
 */
function bp_tracker_check_requirements(): void {
	$error = bp_tracker_jwt_secret_error( defined( 'BP_TRACKER_JWT_SECRET' ) ? constant( 'BP_TRACKER_JWT_SECRET' ) : null );

	if ( null !== $error ) {
		wp_die(
			esc_html( $error ),
			esc_html__( 'BP Tracker could not be activated', 'bp-tracker' ),
			array( 'back_link' => true )
		);
	}
}

bp_tracker_load_env_file( __DIR__ );
bp_tracker_define_from_env( 'BP_TRACKER_JWT_SECRET' );
bp_tracker_define_from_env( 'BP_TRACKER_FRONTEND_ORIGIN' );
bp_tracker_define_from_env( 'BP_TRACKER_TRUSTED_PROXIES' );

register_activation_hook( __FILE__, 'bp_tracker_check_requirements' );

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
