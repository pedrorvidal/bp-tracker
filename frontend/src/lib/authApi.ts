import axios from 'axios'
import type { AuthSession, AuthTokensResponse } from '../types'
import { api, refreshSession, toAuthTokens } from './api'
import { getRefreshToken, setSession } from './authStore'
import { getUserIdFromToken } from './jwt'

/**
 * Signs in and stores the new session.
 *
 * @throws AxiosError When the credentials are rejected or the request fails.
 */
export async function login(
  username: string,
  password: string,
): Promise<AuthSession> {
  const { data } = await api.post<AuthTokensResponse>('/auth/login', {
    username,
    password,
  })
  const tokens = toAuthTokens(data)
  const session: AuthSession = {
    tokens,
    user: { id: getUserIdFromToken(tokens.accessToken), username },
  }

  setSession(session)
  return session
}

async function revoke(refreshToken: string): Promise<void> {
  await api.post('/auth/logout', { refresh_token: refreshToken })
}

/**
 * Revokes the refresh token on the server, then clears the local session.
 *
 * The local session is always cleared, even if the server can't be reached:
 * signing out must never leave the user signed in on this device.
 */
export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken()

  try {
    if (refreshToken) {
      try {
        await revoke(refreshToken)
      } catch (error) {
        // An expired access token can't authenticate /auth/logout. Refresh
        // (which rotates the pair) and revoke the *new* refresh token, or it
        // would stay valid on the server for its full lifetime.
        if (!axios.isAxiosError(error) || error.response?.status !== 401) {
          throw error
        }
        const tokens = await refreshSession()
        await revoke(tokens.refreshToken)
      }
    }
  } catch {
    // Best effort: server-side revocation failed, but the local session is
    // still cleared below.
  } finally {
    setSession(null)
  }
}
