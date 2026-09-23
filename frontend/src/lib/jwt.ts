/**
 * Reads the "user_id" claim from an access token issued by the backend.
 *
 * The payload is decoded, not verified: the signature is the server's
 * concern, and the value is only used to identify the user in the UI.
 *
 * @throws Error When the token is malformed or has no positive user_id.
 */
export function getUserIdFromToken(token: string): number {
  const payload = token.split('.')[1]

  if (!payload) {
    throw new Error('Malformed access token.')
  }

  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const claims: unknown = JSON.parse(atob(padded))

  if (typeof claims === 'object' && claims !== null && 'user_id' in claims) {
    const userId = claims.user_id

    if (typeof userId === 'number' && Number.isInteger(userId) && userId > 0) {
      return userId
    }
  }

  throw new Error('Access token has no valid user_id claim.')
}
