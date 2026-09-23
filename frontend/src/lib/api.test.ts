import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeSession, makeTokensResponse } from '../test/fixtures'
import { mockApi, restError } from '../test/mockApi'
import {
  DEFAULT_API_URL,
  REFRESH_LOCK,
  api,
  initializeSession,
  isApiError,
  refreshSession,
  toSession,
} from './api'
import {
  getAuthState,
  getSession,
  resetAuthStore,
  setSession,
} from './authStore'

const expired = restError(
  'bp_tracker_jwt_invalid_token',
  'Invalid or expired access token.',
  401,
)
const refreshRejected = restError(
  'bp_tracker_jwt_invalid_refresh_token',
  'Invalid or expired refresh token.',
  401,
)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('request preparation', () => {
  it('sends "Authorization: Bearer <access token>" to data routes when signed in', async () => {
    setSession(makeSession('a'))
    const http = mockApi({ 'GET /readings': { status: 200, data: [] } })

    await api.get('/readings')

    expect(http.calls[0]).toMatchObject({
      authorization: 'Bearer access-a',
      csrf: undefined,
      withCredentials: false,
    })
  })

  it('sends no Authorization header when signed out', async () => {
    const http = mockApi({ 'GET /readings': { status: 200, data: [] } })

    await api.get('/readings')

    expect(http.calls[0]?.authorization).toBeUndefined()
  })

  it.each(['/auth/login', '/auth/refresh', '/auth/logout', '/auth/logout-all'])(
    '%s: sends the refresh cookie and CSRF header, never a Bearer token',
    async (path) => {
      setSession(makeSession('a'))
      const http = mockApi({ [`POST ${path}`]: { status: 200, data: {} } })

      await api.post(path, {})

      expect(http.calls[0]).toMatchObject({
        authorization: undefined,
        csrf: '1',
        withCredentials: true,
      })
    },
  )

  it('uses the token current at request time, not at client creation', async () => {
    const http = mockApi({ 'GET /readings': { status: 200, data: [] } })

    await api.get('/readings')
    setSession(makeSession('b'))
    await api.get('/readings')

    expect(http.calls[0]?.authorization).toBeUndefined()
    expect(http.calls[1]?.authorization).toBe('Bearer access-b')
  })
})

describe('toSession', () => {
  it('maps the API response and computes expiresAt from expires_in', () => {
    expect(toSession(makeTokensResponse('x', 9), 1_000)).toEqual({
      tokens: { accessToken: 'access-x', expiresAt: 1_000 + 3_600_000 },
      user: { id: 9, username: 'admin', displayName: 'Ada Admin' },
    })
  })
})

describe('refreshSession', () => {
  it('posts to /auth/refresh without a body and stores the new session', async () => {
    const http = mockApi({
      'POST /auth/refresh': { status: 200, data: makeTokensResponse('new', 4) },
    })

    const session = await refreshSession()

    expect(http.calls[0]?.body).toBeUndefined()
    expect(session.tokens.accessToken).toBe('access-new')
    expect(getAuthState()).toEqual({ status: 'authenticated', session })
  })

  it('shares one request between concurrent callers', async () => {
    const http = mockApi({
      'POST /auth/refresh': async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { status: 200, data: makeTokensResponse('new') }
      },
    })

    await Promise.all([refreshSession(), refreshSession(), refreshSession()])

    expect(http.calls).toHaveLength(1)
  })

  it('holds the cross-tab Web Lock while refreshing', async () => {
    const request = vi.fn((_name: string, callback: () => Promise<unknown>) =>
      callback(),
    )
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    mockApi({
      'POST /auth/refresh': { status: 200, data: makeTokensResponse('new') },
    })

    await refreshSession()

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toBe(REFRESH_LOCK)
  })

  it('signs out when the server rejects the refresh cookie', async () => {
    setSession(makeSession('old'))
    mockApi({ 'POST /auth/refresh': refreshRejected })

    await expect(refreshSession()).rejects.toBeInstanceOf(AxiosError)
    expect(getAuthState()).toEqual({ status: 'unauthenticated', session: null })
  })

  it('keeps the session on a network error', async () => {
    setSession(makeSession('old'))
    mockApi({ 'POST /auth/refresh': 'network-error' })

    await expect(refreshSession()).rejects.toBeInstanceOf(AxiosError)
    expect(getSession()?.tokens.accessToken).toBe('access-old')
  })
})

describe('initializeSession (page load)', () => {
  it('restores the session from the refresh cookie', async () => {
    resetAuthStore()
    mockApi({
      'POST /auth/refresh': { status: 200, data: makeTokensResponse('a', 2) },
    })

    await initializeSession()

    expect(getAuthState().status).toBe('authenticated')
    expect(getSession()?.user).toEqual({
      id: 2,
      username: 'admin',
      displayName: 'Ada Admin',
    })
  })

  it.each([
    ['no valid refresh cookie', refreshRejected],
    ['a network error', 'network-error' as const],
    ['a server error', restError('internal', 'Boom.', 500)],
  ])('ends signed out after %s, never stuck loading', async (_label, reply) => {
    resetAuthStore()
    mockApi({ 'POST /auth/refresh': reply })

    await initializeSession()

    expect(getAuthState()).toEqual({ status: 'unauthenticated', session: null })
  })

  it('makes one request when called twice at once (StrictMode effects)', async () => {
    resetAuthStore()
    const http = mockApi({
      'POST /auth/refresh': { status: 200, data: makeTokensResponse('a') },
    })

    await Promise.all([initializeSession(), initializeSession()])

    expect(http.calls).toHaveLength(1)
  })

  it('does nothing once the session is settled', async () => {
    setSession(makeSession('a'))
    const http = mockApi({})

    await initializeSession()

    expect(http.calls).toHaveLength(0)
  })
})

describe('automatic refresh on 401', () => {
  it('refreshes once and retries the request with the new access token', async () => {
    setSession(makeSession('old'))
    const http = mockApi({
      'GET /readings': [expired, { status: 200, data: ['ok'] }],
      'POST /auth/refresh': { status: 200, data: makeTokensResponse('new') },
    })

    const response = await api.get('/readings')

    expect(response.data).toEqual(['ok'])
    expect(http.callsTo('POST /auth/refresh')).toHaveLength(1)
    expect(http.callsTo('GET /readings')[1]?.authorization).toBe(
      'Bearer access-new',
    )
  })

  it('shares one refresh between concurrent 401s (refresh tokens are single-use)', async () => {
    setSession(makeSession('old'))
    const http = mockApi({
      'GET /readings': [expired, expired, expired, { status: 200, data: [] }],
      'POST /auth/refresh': async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { status: 200, data: makeTokensResponse('new') }
      },
    })

    await Promise.all([
      api.get('/readings'),
      api.get('/readings'),
      api.get('/readings'),
    ])

    expect(http.callsTo('POST /auth/refresh')).toHaveLength(1)
  })

  it('signs out and rejects when the refresh is rejected', async () => {
    setSession(makeSession('old'))
    const http = mockApi({
      'GET /readings': expired,
      'POST /auth/refresh': refreshRejected,
    })

    await expect(api.get('/readings')).rejects.toMatchObject({
      response: { status: 401 },
    })
    expect(getSession()).toBeNull()
    expect(http.callsTo('GET /readings')).toHaveLength(1)
  })

  it('keeps the session when the refresh fails for a network reason', async () => {
    setSession(makeSession('old'))
    mockApi({
      'GET /readings': expired,
      'POST /auth/refresh': 'network-error',
    })

    await expect(api.get('/readings')).rejects.toBeInstanceOf(AxiosError)
    expect(getSession()?.tokens.accessToken).toBe('access-old')
  })

  it('does not loop when the retried request is rejected again', async () => {
    setSession(makeSession('old'))
    const http = mockApi({
      // Stops replying 401 after a few calls, so a refresh/retry loop ends in
      // an (unexpected) success and fails this test instead of hanging it.
      'GET /readings': [expired, expired, expired, { status: 200, data: [] }],
      'POST /auth/refresh': { status: 200, data: makeTokensResponse('new') },
    })

    await expect(api.get('/readings')).rejects.toMatchObject({
      response: { status: 401 },
    })
    expect(http.callsTo('POST /auth/refresh')).toHaveLength(1)
    expect(http.callsTo('GET /readings')).toHaveLength(2)
  })

  it.each(['/auth/login', '/auth/refresh', '/auth/logout', '/auth/logout-all'])(
    'does not refresh on a 401 from %s',
    async (path) => {
      setSession(makeSession('old'))
      const http = mockApi({ [`POST ${path}`]: expired })

      await expect(api.post(path, {})).rejects.toBeInstanceOf(AxiosError)
      expect(http.calls).toHaveLength(1)
    },
  )

  it('does not refresh when signed out', async () => {
    const http = mockApi({ 'GET /readings': expired })

    await expect(api.get('/readings')).rejects.toBeInstanceOf(AxiosError)
    expect(http.calls).toHaveLength(1)
  })

  it.each([403, 404, 500])('passes a %i through untouched', async (status) => {
    setSession(makeSession('old'))
    const http = mockApi({
      'GET /readings': restError('some_error', 'Nope.', status),
    })

    await expect(api.get('/readings')).rejects.toMatchObject({
      response: { status },
    })
    expect(http.calls).toHaveLength(1)
    expect(getSession()).not.toBeNull()
  })
})

describe('base URL', () => {
  it('resolves request paths against the API base URL', () => {
    expect(api.getUri({ url: '/stats' })).toBe(`${api.defaults.baseURL}/stats`)
  })

  it('defaults to the local wp-env URL when VITE_API_URL is empty', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.resetModules()

    const { api: freshApi } = await import('./api')

    expect(freshApi.defaults.baseURL).toBe(DEFAULT_API_URL)
    expect(DEFAULT_API_URL).toBe('http://localhost:8888/wp-json/bp-tracker/v1')
  })

  it('uses VITE_API_URL when it is set', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com/wp-json/bp-tracker/v1')
    vi.resetModules()

    const { api: freshApi } = await import('./api')

    expect(freshApi.defaults.baseURL).toBe(
      'https://api.example.com/wp-json/bp-tracker/v1',
    )
  })
})

describe('isApiError', () => {
  function axiosErrorWith(data: unknown): AxiosError {
    const config = { headers: new AxiosHeaders() }
    return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
      data,
      status: 404,
      statusText: 'Not Found',
      headers: {},
      config,
    })
  }

  it('accepts an Axios error carrying a WordPress REST error body', () => {
    const error = axiosErrorWith({
      code: 'bp_tracker_rest_not_found',
      message: 'Reading not found.',
      data: { status: 404 },
    })

    expect(isApiError(error)).toBe(true)
  })

  it('rejects an Axios error without a REST error body', () => {
    expect(isApiError(axiosErrorWith('<html>Bad gateway</html>'))).toBe(false)
  })

  it('rejects non-Axios errors', () => {
    expect(isApiError(new Error('boom'))).toBe(false)
    expect(isApiError(undefined)).toBe(false)
  })
})
