/**
 * Holds the current access token for the API client.
 *
 * Kept in memory only: where tokens are persisted (and how the refresh
 * token is stored) is decided by the auth context, which calls
 * setAccessToken() whenever it logs in, refreshes or logs out.
 */
let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}
