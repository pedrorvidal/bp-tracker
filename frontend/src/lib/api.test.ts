import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_API_URL, api, isApiError } from './api'
import { setAccessToken } from './authTokens'

/** Captures the final request config instead of hitting the network. */
function captureRequest() {
  const seen: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = (config) => {
    seen.push(config)
    return Promise.resolve({
      data: null,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
  }
  return { seen, adapter }
}

afterEach(() => {
  setAccessToken(null)
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('api client', () => {
  it('sends "Authorization: Bearer <token>" when an access token is set', async () => {
    setAccessToken('abc.def.ghi')
    const { seen, adapter } = captureRequest()

    await api.get('/readings', { adapter })

    expect(seen[0]?.headers.get('Authorization')).toBe('Bearer abc.def.ghi')
  })

  it('sends no Authorization header without an access token', async () => {
    const { seen, adapter } = captureRequest()

    await api.get('/readings', { adapter })

    expect(seen[0]?.headers.has('Authorization')).toBe(false)
  })

  it('picks up a token set after the client was created', async () => {
    const { seen, adapter } = captureRequest()

    await api.get('/readings', { adapter })
    setAccessToken('rotated-token')
    await api.get('/readings', { adapter })

    expect(seen[0]?.headers.has('Authorization')).toBe(false)
    expect(seen[1]?.headers.get('Authorization')).toBe('Bearer rotated-token')
  })

  it('resolves request paths against the API base URL', async () => {
    const { seen, adapter } = captureRequest()

    await api.get('/stats', { adapter })

    expect(seen[0]?.baseURL).toBe(api.defaults.baseURL)
    expect(seen[0]?.url).toBe('/stats')
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
