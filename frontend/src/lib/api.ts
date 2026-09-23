import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiErrorResponse, AuthTokens, AuthTokensResponse } from '../types'
import {
  getAccessToken,
  getRefreshToken,
  setSession,
  updateTokens,
} from './authStore'

declare module 'axios' {
  interface InternalAxiosRequestConfig {
    /** Set once a request has been retried after a token refresh. */
    _retriedAfterRefresh?: boolean
  }
}

export const DEFAULT_API_URL = 'http://localhost:8888/wp-json/bp-tracker/v1'

export const API_URL: string = import.meta.env.VITE_API_URL || DEFAULT_API_URL

/** Pre-configured client for the bp-tracker/v1 namespace. */
export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

/**
 * Routes that must never carry a Bearer token: the backend rejects any
 * request with an invalid/expired Bearer header before reaching the route,
 * which would make it impossible to log in or refresh with a stale token.
 */
const UNAUTHENTICATED_PATHS = ['/auth/login', '/auth/refresh']

/** Auth routes whose 401s must not trigger an automatic refresh. */
const AUTH_PATHS = [...UNAUTHENTICATED_PATHS, '/auth/logout']

function matchesPath(url: string | undefined, paths: string[]): boolean {
  if (!url) {
    return false
  }
  const path = url.split('?')[0] ?? ''
  return paths.some((p) => path === p || path.endsWith(p))
}

/** Adds "Authorization: Bearer <access_token>" when signed in (except on login/refresh). */
export function attachAccessToken(
  config: InternalAxiosRequestConfig,
): InternalAxiosRequestConfig {
  if (matchesPath(config.url, UNAUTHENTICATED_PATHS)) {
    config.headers.delete('Authorization')
    return config
  }

  const token = getAccessToken()

  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }

  return config
}

api.interceptors.request.use(attachAccessToken)

/** Converts the API's token response into the client-side shape. */
export function toAuthTokens(
  data: AuthTokensResponse,
  now: number = Date.now(),
): AuthTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: now + data.expires_in * 1000,
  }
}

/** Whether the server rejected the request itself (4xx), as opposed to a network/server failure. */
function isClientError(error: unknown): boolean {
  if (!axios.isAxiosError(error) || !error.response) {
    return false
  }
  return error.response.status >= 400 && error.response.status < 500
}

let refreshInFlight: Promise<AuthTokens> | null = null

/**
 * Exchanges the stored refresh token for a new pair and stores it.
 *
 * Single-flight: refresh tokens are single-use, so concurrent callers share
 * one request instead of racing (the loser would otherwise be rejected and
 * sign the user out). If the server rejects the refresh token, the session
 * is cleared; on network/server errors the session is kept so a transient
 * failure doesn't sign the user out.
 */
export function refreshSession(): Promise<AuthTokens> {
  refreshInFlight ??= (async () => {
    const refreshToken = getRefreshToken()

    if (!refreshToken) {
      setSession(null)
      throw new Error('No refresh token available.')
    }

    try {
      const { data } = await api.post<AuthTokensResponse>('/auth/refresh', {
        refresh_token: refreshToken,
      })
      const tokens = toAuthTokens(data)
      updateTokens(tokens)
      return tokens
    } catch (error) {
      if (isClientError(error)) {
        setSession(null)
      }
      throw error
    }
  })().finally(() => {
    refreshInFlight = null
  })

  return refreshInFlight
}

/** On a 401, refreshes the session once and retries the original request. */
export async function retryAfterRefresh(error: unknown): Promise<unknown> {
  if (
    !axios.isAxiosError(error) ||
    error.response?.status !== 401 ||
    !error.config ||
    error.config._retriedAfterRefresh ||
    matchesPath(error.config.url, AUTH_PATHS) ||
    !getRefreshToken()
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
