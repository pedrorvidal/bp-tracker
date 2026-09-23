<?php
/**
 * Tests for loading configuration from backend/.env (bp-tracker.php).
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_Env_Config_Test
 */
class BP_Tracker_Env_Config_Test extends WP_UnitTestCase {

	/**
	 * Temporary directory holding a test .env file.
	 *
	 * @var string
	 */
	private string $dir;

	/**
	 * Environment variable names touched by a test, cleaned up afterwards.
	 *
	 * @var string[]
	 */
	private array $touched = array();

	/**
	 * Creates an empty temporary directory.
	 */
	public function setUp(): void {
		parent::setUp();

		$this->dir = get_temp_dir() . 'bp-tracker-env-' . wp_generate_password( 8, false );
		wp_mkdir_p( $this->dir );
	}

	/**
	 * Removes the directory and any variable a test set.
	 */
	public function tearDown(): void {
		if ( file_exists( $this->dir . '/.env' ) ) {
			wp_delete_file( $this->dir . '/.env' );
		}
		rmdir( $this->dir ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir -- removes the test's own temp dir.

		foreach ( $this->touched as $name ) {
			unset( $_ENV[ $name ], $_SERVER[ $name ] );
			putenv( $name ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- unsets a variable the test itself set.
		}

		parent::tearDown();
	}

	/**
	 * Writes the test .env file.
	 *
	 * @param array<string, string> $vars Variables to write.
	 */
	private function write_env( array $vars ): void {
		$lines = '';
		foreach ( $vars as $name => $value ) {
			$this->touched[] = $name;
			$lines          .= "{$name}={$value}\n";
		}
		file_put_contents( $this->dir . '/.env', $lines ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- test fixture in a temp dir.
	}

	/**
	 * A unique variable/constant name for one test.
	 *
	 * @param string $suffix Readable suffix.
	 * @return string
	 */
	private function name( string $suffix ): string {
		$name            = 'BP_TRACKER_TEST_' . strtoupper( $suffix ) . '_' . strtoupper( wp_generate_password( 6, false ) );
		$this->touched[] = $name;

		return $name;
	}

	/**
	 * Values from .env become readable through bp_tracker_env().
	 */
	public function test_loads_values_from_the_env_file(): void {
		$name = $this->name( 'loaded' );
		$this->write_env( array( $name => 'from-file' ) );

		bp_tracker_load_env_file( $this->dir );

		$this->assertSame( 'from-file', bp_tracker_env( $name ) );
	}

	/**
	 * The file isn't put into the process environment (no putenv()), so it
	 * doesn't leak into child processes.
	 */
	public function test_does_not_putenv(): void {
		$name = $this->name( 'no_putenv' );
		$this->write_env( array( $name => 'from-file' ) );

		bp_tracker_load_env_file( $this->dir );

		$this->assertFalse( getenv( $name ) );
	}

	/**
	 * A real environment variable wins over the .env file.
	 */
	public function test_real_environment_wins_over_the_file(): void {
		$name = $this->name( 'real' );
		putenv( "{$name}=from-environment" ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- simulates a real environment variable.
		$this->write_env( array( $name => 'from-file' ) );

		bp_tracker_load_env_file( $this->dir );

		$this->assertSame( 'from-environment', bp_tracker_env( $name ) );
	}

	/**
	 * Immutable loading: a value already in $_ENV isn't overwritten by the file.
	 */
	public function test_file_does_not_override_existing_values(): void {
		$name          = $this->name( 'immutable' );
		$_ENV[ $name ] = 'already-set';
		$this->write_env( array( $name => 'from-file' ) );

		bp_tracker_load_env_file( $this->dir );

		$this->assertSame( 'already-set', bp_tracker_env( $name ) );
	}

	/**
	 * No .env file is fine (production may use wp-config.php).
	 */
	public function test_missing_file_is_ignored(): void {
		bp_tracker_load_env_file( $this->dir );

		$this->assertNull( bp_tracker_env( $this->name( 'missing' ) ) );
	}

	/**
	 * Empty or blank values count as unset.
	 */
	public function test_empty_values_count_as_unset(): void {
		$empty = $this->name( 'empty' );
		$blank = $this->name( 'blank' );
		$this->write_env(
			array(
				$empty => '',
				$blank => '"   "',
			)
		);

		bp_tracker_load_env_file( $this->dir );

		$this->assertNull( bp_tracker_env( $empty ) );
		$this->assertNull( bp_tracker_env( $blank ) );
	}

	/**
	 * bp_tracker_define_from_env() defines the constant from the environment.
	 */
	public function test_defines_the_constant_from_the_environment(): void {
		$name = $this->name( 'define' );
		$this->write_env( array( $name => 'value' ) );
		bp_tracker_load_env_file( $this->dir );

		bp_tracker_define_from_env( $name );

		$this->assertTrue( defined( $name ) );
		$this->assertSame( 'value', constant( $name ) );
	}

	/**
	 * A constant already defined (wp-config.php) is never overridden.
	 */
	public function test_existing_constant_wins(): void {
		$name = $this->name( 'predefined' );
		define( $name, 'from-wp-config' ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.VariableConstantNameFound -- prefixed test constant.
		$this->write_env( array( $name => 'from-file' ) );
		bp_tracker_load_env_file( $this->dir );

		bp_tracker_define_from_env( $name );

		$this->assertSame( 'from-wp-config', constant( $name ) );
	}

	/**
	 * Nothing is defined when the environment has no value.
	 */
	public function test_does_not_define_empty_values(): void {
		$name = $this->name( 'undefined' );

		bp_tracker_define_from_env( $name );

		$this->assertFalse( defined( $name ) );
	}

	/**
	 * Only BP_TRACKER_ constants can be defined this way.
	 */
	public function test_refuses_unprefixed_constants(): void {
		$name            = 'NOT_OURS_' . strtoupper( wp_generate_password( 6, false ) );
		$this->touched[] = $name;
		$this->write_env( array( $name => 'value' ) );
		bp_tracker_load_env_file( $this->dir );

		bp_tracker_define_from_env( $name );

		$this->assertFalse( defined( $name ) );
	}

	/**
	 * The JWT secret must be set and at least 32 bytes (HS256).
	 *
	 * @dataProvider provide_secrets
	 *
	 * @param mixed  $secret   Configured secret.
	 * @param string $expected 'ok', or a fragment of the error message.
	 */
	public function test_jwt_secret_validation( mixed $secret, string $expected ): void {
		$error = bp_tracker_jwt_secret_error( $secret );

		if ( 'ok' === $expected ) {
			$this->assertNull( $error );
		} else {
			$this->assertIsString( $error );
			$this->assertStringContainsString( $expected, $error );
		}
	}

	/**
	 * Secrets to validate.
	 *
	 * @return array<string, array{0: mixed, 1: string}>
	 */
	public static function provide_secrets(): array {
		return array(
			'not configured'    => array( null, 'is not set' ),
			'empty'             => array( '', 'is not set' ),
			'blank'             => array( '   ', 'is not set' ),
			'not a string'      => array( 12345, 'is not set' ),
			'31 bytes'          => array( str_repeat( 'a', 31 ), 'too short' ),
			'32 bytes'          => array( str_repeat( 'a', 32 ), 'ok' ),
			'openssl base64 48' => array( base64_encode( random_bytes( 48 ) ), 'ok' ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- mirrors `openssl rand -base64 48`.
		);
	}

	/**
	 * The requirement check runs on activation, before any other activation
	 * callback (so nothing, e.g. table creation, happens without a secret).
	 */
	public function test_requirements_are_checked_first_on_activation(): void {
		global $wp_filter;

		$hook = 'activate_' . plugin_basename( BP_TRACKER_FILE );
		$this->assertArrayHasKey( $hook, $wp_filter );

		$callbacks = array();
		foreach ( $wp_filter[ $hook ]->callbacks as $by_priority ) {
			foreach ( $by_priority as $callback ) {
				$callbacks[] = $callback['function'];
			}
		}

		$this->assertSame( 'bp_tracker_check_requirements', $callbacks[0] ?? null );
		$this->assertContains( array( BP_Tracker_JWT_Auth::class, 'create_tables' ), $callbacks );
	}

	/**
	 * With a valid secret configured, activation proceeds.
	 */
	public function test_activation_passes_with_a_valid_secret(): void {
		bp_tracker_check_requirements();

		$this->assertNull( bp_tracker_jwt_secret_error( BP_TRACKER_JWT_SECRET ) );
	}

	/**
	 * The plugin directory denies dotfiles over HTTP, so backend/.env can't
	 * be downloaded (Apache).
	 */
	public function test_htaccess_denies_dotfiles(): void {
		$htaccess = (string) file_get_contents( BP_TRACKER_DIR . '.htaccess' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.

		$this->assertMatchesRegularExpression( '/<FilesMatch "\^\\\\\.">\s*Require all denied\s*<\/FilesMatch>/', $htaccess );
	}
}
