<?php
/**
 * Smoke test confirming the PHPUnit suite is wired up correctly.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_Smoke_Test
 */
class BP_Tracker_Smoke_Test extends WP_UnitTestCase {

	/**
	 * The suite runs and WordPress test bootstrap is loaded.
	 */
	public function test_suite_runs(): void {
		$this->assertTrue( true );
	}
}
