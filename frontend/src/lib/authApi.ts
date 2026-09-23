import axios from 'axios'
import type { AuthSession, AuthTokensResponse } from '../types'
import { api, toSession } from './api'
import { getAuthState, setSession } from './authStore'

/** Tells other tabs of this app that the user signed out. */
const CHANNEL_NAME = 'bp-tracker-auth'

type AuthMessage = { type: 'logout' }

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel(CHANNEL_NAME)
}

/**
 * Signs in: the backend sets the refresh cookie and returns the access token.
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
  const session = toSession(data)

  setSession(session)
  return session
}

/**
 * Revokes the refresh cookie on the server, clears the local session and
 * signs out every other open tab.
 *
 * The local session is always cleared, even if the server can't be reached:
 * signing out must never leave the user signed in on this device.
 */
export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout')
  } catch {
    // Best effort: server-side revocation failed, but the local session is
    // still cleared below.
  } finally {
    endLocalSession()
  }
}

/**
 * Signs the user out of every device: revokes all their sessions on the
 * server, then ends this one (and every other open tab).
 *
 * Unlike logout(), this must not pretend to succeed: if the server can't be
 * reached the other devices are still signed in, so the error is thrown and
 * the session kept, letting the user retry. If the server rejects the
 * request (the refresh cookie is no longer valid) the session is over
 * anyway, so it is cleared before throwing.
 *
 * @throws AxiosError When the server didn't revoke the sessions.
 */
export async function logoutEverywhere(): Promise<void> {
  try {
    await api.post('/auth/logout-all')
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response &&
      error.response.status < 500
    ) {
      endLocalSession()
    }
    throw error
  }

  endLocalSession()
}

/** Clears the local session and tells other tabs to do the same. */
function endLocalSession(): void {
  setSession(null)

  const channel = openChannel()
  channel?.postMessage({ type: 'logout' } satisfies AuthMessage)
  channel?.close()
}

/**
 * Signs this tab out when another tab signs out. Returns a cleanup function.
 */
export function listenForLogoutInOtherTabs(): () => void {
  const channel = openChannel()

  if (!channel) {
    return () => undefined
  }

  channel.onmessage = (event: MessageEvent<AuthMessage>) => {
    if (event.data.type === 'logout' && getAuthState().session) {
      setSession(null)
    }
  }

  return () => {
    channel.close()
  }
}
