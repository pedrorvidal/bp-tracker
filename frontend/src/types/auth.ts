/**
 * The access token held in memory.
 *
 * The refresh token is never visible to JavaScript: the backend keeps it in
 * an HttpOnly cookie scoped to the /auth routes.
 */
export interface AuthTokens {
  /** Short-lived JWT sent as "Authorization: Bearer <accessToken>". */
  accessToken: string
  /** When the access token expires, in epoch milliseconds. */
  expiresAt: number
}

/** The signed-in user. */
export interface User {
  /** WordPress user ID. */
  id: number
  /** WordPress login name. */
  username: string
  displayName: string
}

/** Everything known about the signed-in user's session. */
export interface AuthSession {
  tokens: AuthTokens
  user: User
}

/**
 * - `loading`: restoring the session from the refresh cookie on page load.
 * - `authenticated` / `unauthenticated`: settled.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

/** Response body of POST /auth/login and POST /auth/refresh. */
export interface AuthTokensResponse {
  access_token: string
  token_type: 'Bearer'
  /** Access token lifetime, in seconds. */
  expires_in: number
  user: {
    id: number
    username: string
    display_name: string
  }
}
