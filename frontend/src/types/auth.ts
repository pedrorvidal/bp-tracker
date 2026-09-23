/** Client-side view of the token pair issued by /auth/login and /auth/refresh. */
export interface AuthTokens {
  /** Short-lived JWT sent as "Authorization: Bearer <accessToken>". */
  accessToken: string
  /** Opaque, single-use token exchanged for a new pair at /auth/refresh. */
  refreshToken: string
  /** When the access token expires, in epoch milliseconds. */
  expiresAt: number
}

/** The signed-in user. */
export interface User {
  /** WordPress user ID, taken from the access token's "user_id" claim. */
  id: number
  /** The username (or email) the user signed in with. */
  username: string
}

/** Everything persisted for a signed-in user. */
export interface AuthSession {
  tokens: AuthTokens
  user: User
}

/** Response body of POST /auth/login and POST /auth/refresh. */
export interface AuthTokensResponse {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  /** Access token lifetime, in seconds. */
  expires_in: number
}
