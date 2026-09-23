import type { AuthSession, AuthTokensResponse } from '../types'

function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Builds an (unsigned) JWT shaped like the backend's access tokens. */
export function makeAccessToken(userId = 1, label = 'a'): string {
  const header = base64Url({ typ: 'JWT', alg: 'HS256' })
  const payload = base64Url({
    iss: 'http://localhost:8888',
    iat: 1_790_000_000,
    exp: 1_790_003_600,
    jti: label,
    user_id: userId,
  })
  return `${header}.${payload}.signature-${label}`
}

/** A token response as returned by /auth/login and /auth/refresh. */
export function makeTokensResponse(
  label = 'a',
  userId = 1,
): AuthTokensResponse {
  return {
    access_token: makeAccessToken(userId, label),
    refresh_token: `refresh-${label}`,
    token_type: 'Bearer',
    expires_in: 3600,
  }
}

/** A signed-in session. */
export function makeSession(label = 'a', userId = 1): AuthSession {
  return {
    tokens: {
      accessToken: makeAccessToken(userId, label),
      refreshToken: `refresh-${label}`,
      expiresAt: Date.now() + 3_600_000,
    },
    user: { id: userId, username: 'admin' },
  }
}
