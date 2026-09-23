import type { AuthSession, AuthTokensResponse } from '../types'

/** A token response as returned by /auth/login and /auth/refresh. */
export function makeTokensResponse(
  label = 'a',
  userId = 1,
): AuthTokensResponse {
  return {
    access_token: `access-${label}`,
    token_type: 'Bearer',
    expires_in: 3600,
    user: { id: userId, username: 'admin', display_name: 'Ada Admin' },
  }
}

/** A signed-in session. */
export function makeSession(label = 'a', userId = 1): AuthSession {
  return {
    tokens: {
      accessToken: `access-${label}`,
      expiresAt: Date.now() + 3_600_000,
    },
    user: { id: userId, username: 'admin', displayName: 'Ada Admin' },
  }
}
