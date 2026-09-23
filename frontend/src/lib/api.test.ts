import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeSession, makeTokensResponse } from '../test/fixtures'
import { mockApi, restError } from '../test/mockApi'
import { DEFAULT_API_URL, api, isApiError, toAuthTokens } from './api'
import { getSession, setSession } from './authStore'

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
  vi.resetModules()
})

describe('Authorization header', () => {
  it('sends "Authorization: Bearer <access token>" when signed in', async () => {
    const session = makeSession('a')
    setSession(session)
    const http = mockApi({ 'GET /readings': { status: 200, data: [] } })

    await api.get('/readings')

    expect(http.calls[0]?.authorization).toBe(
      `Bearer ${session.tokens.accessToken}`,
    )
  })

  it('sends no Authorization header when signed out', async () => {
    const http = mockApi({ 'GET /readings': { status: 200, data: [] } })

    await api.get('/readings')

    expect(http.calls[0]?.authorization).toBeUndefined()
  })

  it.each(['/auth/login', '/auth/refresh'])(
    'never sends it to %s, even when signed in (a stale token would get the call rejected)',
    async (path) => {
      setSession(makeSession('a'))
      const http = mockApi({ [`POST ${path}`]: { status: 200, data: {} } })

      await api.post(path, {})

      expect(http.calls[0]?.authorization).toBeUndefined()
    },
  )

  it('sends it to /auth/logout, which requires authentication', async () => {
    const session = makeSession('a')
    setSession(session)
    const http = mockApi({ 'POST /auth/logout': { status: 200, data: {} } })

    await api.post('/auth/logout', {})

    expect(http.calls[0]?.authorization).toBe(
      `Bearer ${session.tokens.accessToken}`,
    )
  })

  it('uses the token current at request time, not at client creation', async () => {
    const http = mockApi({ 'GET /readings': { status: 200, data: [] } })

    await api.get('/readings')
    const session = makeSession('b')
    setSession(session)
    await api.get('/readings')

    expect(http.calls[0]?.authorization).toBeUndefined()
    expect(http.calls[1]?.authorization).toBe(
      `Bearer ${session.tokens.accessToken}`,
    )
  })
})

describe('toAuthTokens', () => {
  it('maps the API response and computes expiresAt from expires_in', () => {
    const response = makeTokensResponse('x')

    expect(toAuthTokens(response, 1_000)).toEqual({
      accessToken: response.access_token,
      refreshToken: 'refresh-x',
      expiresAt: 1_000 + 3_600_000,
    })
  })
})

describe('automatic refresh on 401', () => {
  it('refreshes once and retries the request with the new access token', async () => {
    setSession(makeSession('old'))
    const rotated = makeTokensResponse('new')
    const http = mockApi({
      'GET /readings': [expired, { status: 200, data: ['ok'] }],
      'POST /auth/refresh': { status: 200, data: rotated },
    })

    const response = await api.get('/readings')

    expect(response.data).toEqual(['ok'])
    expect(http.callsTo('POST /auth/refresh')).toHaveLength(1)
    expect(http.callsTo('POST /auth/refresh')[0]?.body).toEqual({
      refresh_token: 'refresh-old',
    })
    expect(http.callsTo('GET /readings')[1]?.authorization).toBe(
      `Bearer ${rotated.access_token}`,
    )
  })

  it('stores the rotated token pair and keeps the user', async () => {
    const session = makeSession('old')
    setSession(session)
    mockApi({
      'GET /readings': [expired, { status: 200, data: [] }],
      'POST /auth/refresh': { status: 200, data: makeTokensResponse('new') },
    })

    await api.get('/readings')

    expect(getSession()?.tokens.refreshToken).toBe('refresh-new')
    expect(getSession()?.user).toEqual(session.user)
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

  it('signs out and rejects when the refresh token is rejected', async () => {
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
    expect(getSession()?.tokens.refreshToken).toBe('refresh-old')
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

  it.each(['/auth/login', '/auth/refresh', '/auth/logout'])(
    'does not refresh on a 401 from %s',
    async (path) => {
      setSession(makeSession('old'))
      const http = mockApi({ [`POST ${path}`]: expired })

      await expect(api.post(path, {})).rejects.toBeInstanceOf(AxiosError)
      expect(http.callsTo('POST /auth/refresh')).toHaveLength(
        path === '/auth/refresh' ? 1 : 0,
      )
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
