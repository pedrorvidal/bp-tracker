<?php
/**
 * Algorithm confusion tests for BP_Tracker_JWT_Auth: only HS256 access
 * tokens are accepted, whatever the token's own header says.
 *
 * @package BP_Tracker
 */

declare(strict_types=1);

/**
 * Class BP_Tracker_JWT_Algorithm_Test
 */
class BP_Tracker_JWT_Algorithm_Test extends WP_UnitTestCase {

	/**
	 * User the forged tokens claim to be.
	 *
	 * @var int
	 */
	private int $user_id;

	/**
	 * Creates the target user.
	 */
	public function setUp(): void {
		parent::setUp();

		$this->user_id = self::factory()->user->create(
			array(
				'user_login' => 'alg-target',
				'user_pass'  => 'correct horse battery staple',
				'role'       => BP_Tracker_Roles::USER,
			)
		);
	}

	/**
	 * Clears the simulated Bearer header.
	 */
	public function tearDown(): void {
		unset( $_SERVER['HTTP_AUTHORIZATION'], $GLOBALS['current_user'] );
		wp_set_current_user( 0 );

		parent::tearDown();
	}

	/**
	 * Base64url without padding, as JWTs use.
	 *
	 * @param string $data Raw bytes.
	 * @return string
	 */
	private static function b64url( string $data ): string {
		return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- building JWT segments.
	}

	/**
	 * A payload that would be accepted if the signature checked out.
	 *
	 * @return array<string, mixed>
	 */
	private function valid_claims(): array {
		return array(
			'iss'     => get_bloginfo( 'url' ),
			'iat'     => time(),
			'exp'     => time() + 600,
			'jti'     => wp_generate_uuid4(),
			'user_id' => $this->user_id,
			'gen'     => BP_Tracker_Sessions::generation( $this->user_id ),
		);
	}

	/**
	 * Builds a token by hand, so any header and signature can be forged.
	 *
	 * @param array<string, mixed> $header      JOSE header.
	 * @param string|null          $hmac_algo   hash_hmac() algorithm to sign with, or null for no signature.
	 * @param string               $secret      HMAC key.
	 * @return string
	 */
	private function forge( array $header, ?string $hmac_algo, string $secret = BP_TRACKER_JWT_SECRET ): string {
		$input     = self::b64url( (string) wp_json_encode( $header ) ) . '.' . self::b64url( (string) wp_json_encode( $this->valid_claims() ) );
		$signature = null === $hmac_algo ? '' : self::b64url( hash_hmac( $hmac_algo, $input, $secret, true ) );

		return $input . '.' . $signature;
	}

	/**
	 * Runs the Bearer pipeline for a token.
	 *
	 * @param string $token Access token.
	 * @return array{user: mixed, error: mixed} Resolved user and REST auth error.
	 */
	private function authenticate( string $token ): array {
		$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;

		$user = apply_filters( 'determine_current_user', false );

		return array(
			'user'  => $user,
			'error' => BP_Tracker_JWT_Auth::maybe_return_auth_error( null ),
		);
	}

	/**
	 * Control: a hand-built HS256 token with the real secret is accepted, so
	 * the rejections below are down to the algorithm alone.
	 */
	public function test_forged_hs256_token_with_the_real_secret_is_accepted(): void {
		$result = $this->authenticate(
			$this->forge(
				array(
					'typ' => 'JWT',
					'alg' => 'HS256',
				),
				'sha256'
			)
		);

		$this->assertSame( $this->user_id, $result['user'] );
		$this->assertNull( $result['error'] );
	}

	/**
	 * Issued tokens declare HS256.
	 */
	public function test_issued_tokens_use_hs256(): void {
		$request = new WP_REST_Request( 'POST', '/bp-tracker/v1/auth/login' );
		$request->set_header( BP_Tracker_JWT_Auth::CSRF_HEADER, '1' );
		$request->set_param( 'username', 'alg-target' );
		$request->set_param( 'password', 'correct horse battery staple' );

		$token  = rest_get_server()->dispatch( $request )->get_data()['access_token'];
		$header = json_decode( (string) base64_decode( strtr( explode( '.', $token )[0], '-_', '+/' ) ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- reading a JWT segment.

		$this->assertSame( 'HS256', $header['alg'] );
	}

	/**
	 * Tokens whose header asks for another algorithm (or none) are rejected
	 * with 401, even when their signature is valid for that algorithm.
	 *
	 * @dataProvider data_forged_tokens
	 *
	 * @param array<string, mixed> $header    Forged header.
	 * @param string|null          $hmac_algo Signing algorithm, or null for an empty signature.
	 */
	public function test_forged_algorithm_is_rejected( array $header, ?string $hmac_algo ): void {
		$result = $this->authenticate( $this->forge( $header, $hmac_algo ) );

		$this->assertFalse( $result['user'] );
		$this->assertInstanceOf( WP_Error::class, $result['error'] );
		$this->assertSame( 'bp_tracker_jwt_invalid_token', $result['error']->get_error_code() );
		$this->assertSame( 401, $result['error']->get_error_data()['status'] );
	}

	/**
	 * Forged headers.
	 *
	 * @return array<string, array{array<string, mixed>, string|null}>
	 */
	public static function data_forged_tokens(): array {
		return array(
			'alg none, no signature'           => array( array( 'alg' => 'none' ), null ),
			'alg None, no signature'           => array( array( 'alg' => 'None' ), null ),
			'alg NONE, no signature'           => array( array( 'alg' => 'NONE' ), null ),
			'alg none with an HS256 signature' => array( array( 'alg' => 'none' ), 'sha256' ),
			'no alg at all'                    => array( array( 'typ' => 'JWT' ), 'sha256' ),
			'empty alg'                        => array( array( 'alg' => '' ), 'sha256' ),
			'HS384 signed with the secret'     => array( array( 'alg' => 'HS384' ), 'sha384' ),
			'HS512 signed with the secret'     => array( array( 'alg' => 'HS512' ), 'sha512' ),
			'RS256 header, HMAC signature'     => array( array( 'alg' => 'RS256' ), 'sha256' ),
			'ES256 header, HMAC signature'     => array( array( 'alg' => 'ES256' ), 'sha256' ),
			'EdDSA header, HMAC signature'     => array( array( 'alg' => 'EdDSA' ), 'sha256' ),
			'lowercase hs256'                  => array( array( 'alg' => 'hs256' ), 'sha256' ),
		);
	}

	/**
	 * An HS256 token signed with another secret is rejected too.
	 */
	public function test_hs256_with_the_wrong_secret_is_rejected(): void {
		$result = $this->authenticate( $this->forge( array( 'alg' => 'HS256' ), 'sha256', 'some-other-secret-of-at-least-32-bytes!' ) );

		$this->assertFalse( $result['user'] );
		$this->assertSame( 'bp_tracker_jwt_invalid_token', $result['error']->get_error_code() );
	}

	/**
	 * End to end: a readings request carrying an alg=none token is refused
	 * and creates nothing.
	 */
	public function test_readings_route_refuses_an_alg_none_token(): void {
		$this->authenticate( $this->forge( array( 'alg' => 'none' ), null ) );
		wp_set_current_user( (int) apply_filters( 'determine_current_user', false ) );

		$request = new WP_REST_Request( 'POST', '/bp-tracker/v1/readings' );
		$request->set_param( 'reading_datetime', '2026-09-22T08:30:00+00:00' );
		$request->set_param( 'systolic', 120 );
		$request->set_param( 'diastolic', 80 );

		$this->assertSame( 401, rest_get_server()->dispatch( $request )->get_status() );
		$this->assertSame( 0, (int) count_user_posts( $this->user_id, BP_Tracker_CPT::POST_TYPE ) );
	}
}
