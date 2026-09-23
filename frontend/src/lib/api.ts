import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type {
  ApiErrorResponse,
  AuthSession,
  AuthTokensResponse,
} from '../types'
import { getAccessToken, getAuthState, setSession } from './authStore'

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    /** Set once a request has been retried after a token refresh. */
    _retriedAfterRefresh?: boolean
  }
}

export const DEFAULT_API_URL = 'http://localhost:8888/wp-json/bp-tracker/v1'

export const API_URL: string = import.meta.env.VITE_API_URL || DEFAULT_API_URL

/** Header the backend requires on every /auth route (see docs/api.md). */
export const CSRF_HEADER = 'X-BP-Tracker-CSRF'

/** Web Lock serializing refreshes across tabs, which share the refresh cookie. */
export const REFRESH_LOCK = 'bp-tracker-refresh'

/** Pre-configured client for the bp-tracker/v1 namespace. */
export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

const AUTH_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/logout-all',
]

function isAuthPath(url: string | undefined): boolean {
  if (!url) {
    return false
  }
  const path = url.split('?')[0] ?? ''
  return AUTH_PATHS.some((p) => path === p || path.endsWith(p))
}

/**
 * Auth routes: send the refresh cookie (withCredentials) and the CSRF header,
 * never a Bearer token (the backend rejects any request carrying a stale one).
 * Everything else: "Authorization: Bearer <access token>" when signed in.
 */
export function prepareRequest(
  config: InternalAxiosRequestConfig,
): InternalAxiosRequestConfig {
  if (isAuthPath(config.url)) {
    config.withCredentials = true
    config.headers.set(CSRF_HEADER, '1')
    config.headers.delete('Authorization')
    return config
  }

  const token = getAccessToken()

  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }

  return config
}

api.interceptors.request.use(prepareRequest)

/** Converts the API's token response into the client-side session. */
export function toSession(
  data: AuthTokensResponse,
  now: number = Date.now(),
): AuthSession {
  return {
    tokens: {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    },
    user: {
      id: data.user.id,
      username: data.user.username,
      displayName: data.user.display_name,
    },
  }
}

/** Whether the server rejected the request itself (4xx), as opposed to a network/server failure. */
function isClientError(error: unknown): boolean {
  if (!axios.isAxiosError(error) || !error.response) {
    return false
  }
  return error.response.status >= 400 && error.response.status < 500
}

/** Runs `fn` holding a cross-tab lock, where the Web Locks API exists. */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    return fn()
  }
  return navigator.locks.request(REFRESH_LOCK, fn)
}

let refreshInFlight: Promise<AuthSession> | null = null

/**
 * Exchanges the refresh cookie for a new access token.
 *
 * Refresh tokens are single-use and every tab shares the same cookie, so
 * refreshes are serialized: within a tab concurrent callers share one
 * request, and across tabs a Web Lock makes each wait for the previous one
 * (by then the browser holds the rotated cookie).
 *
 * If the server rejects the refresh, the session is cleared. On a
 * network/server error an existing session is kept, so a transient failure
 * doesn't sign the user out.
 */
export function refreshSession(): Promise<AuthSession> {
  refreshInFlight ??= withRefreshLock(async () => {
    try {
      const { data } = await api.post<AuthTokensResponse>('/auth/refresh')
      const session = toSession(data)
      setSession(session)
      return session
    } catch (error) {
      if (isClientError(error)) {
        setSession(null)
      }
      throw error
    }
  }).finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

/**
 * Restores the session after a page load, using the refresh cookie.
 *
 * Only acts while the session is still "loading"; ends in "authenticated" or
 * "unauthenticated" whatever happens.
 */
export async function initializeSession(): Promise<void> {
  if (getAuthState().status !== 'loading') {
    return
  }

  try {
    await refreshSession()
  } catch {
    if (getAuthState().status === 'loading') {
      setSession(null)
    }
  }
}

/** On a 401, refreshes the session once and retries the original request. */
export async function retryAfterRefresh(error: unknown): Promise<unknown> {
  if (
    !axios.isAxiosError(error) ||
    error.response?.status !== 401 ||
    !error.config ||
    error.config._retriedAfterRefresh ||
    isAuthPath(error.config.url) ||
    getAuthState().status !== 'authenticated'
  ) {
    throw error
  }

  const config = error.config
  config._retriedAfterRefresh = true

  await refreshSession()

  // The request interceptor attaches the new access token.
  return api.request(config)
}

api.interceptors.response.use(undefined, retryAfterRefresh)

/** Narrows an unknown error to an API error that carries a WordPress REST error body. */
export function isApiError(
  error: unknown,
): error is AxiosError<ApiErrorResponse> {
  return (
    axios.isAxiosError<ApiErrorResponse>(error) &&
    typeof error.response?.data?.code === 'string'
  )
}
