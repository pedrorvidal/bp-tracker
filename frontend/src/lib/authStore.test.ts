import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '../test/fixtures'
import {
  LEGACY_STORAGE_KEY,
  getAccessToken,
  getAuthState,
  getSession,
  resetAuthStore,
  setSession,
  subscribe,
} from './authStore'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('authStore', () => {
  it('starts in "loading" until the session is restored', async () => {
    vi.resetModules()
    const fresh = await import('./authStore')

    expect(fresh.getAuthState()).toEqual({ status: 'loading', session: null })
  })

  it('becomes authenticated with a session and unauthenticated without', () => {
    const session = makeSession('a')

    setSession(session)
    expect(getAuthState()).toEqual({ status: 'authenticated', session })
    expect(getSession()).toEqual(session)
    expect(getAccessToken()).toBe('access-a')

    setSession(null)
    expect(getAuthState()).toEqual({ status: 'unauthenticated', session: null })
    expect(getAccessToken()).toBeNull()
  })

  it('resetAuthStore goes back to "loading"', () => {
    setSession(makeSession('a'))

    resetAuthStore()

    expect(getAuthState()).toEqual({ status: 'loading', session: null })
  })

  it('never writes tokens to web storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    setSession(makeSession('a'))
    setSession(makeSession('b'))

    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('purges tokens left in localStorage by earlier versions', async () => {
    window.localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({ tokens: { refreshToken: 'old-refresh' } }),
    )

    vi.resetModules()
    await import('./authStore')

    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull()
  })

  it('loads even when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    vi.resetModules()
    const fresh = await import('./authStore')

    expect(fresh.getAuthState().status).toBe('loading')
  })

  it('keeps the same state object until it changes (useSyncExternalStore contract)', () => {
    setSession(makeSession('a'))

    expect(getAuthState()).toBe(getAuthState())
  })

  it('notifies subscribers on every change until they unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    setSession(makeSession('a'))
    setSession(null)
    unsubscribe()
    setSession(makeSession('b'))

    expect(listener).toHaveBeenCalledTimes(2)
  })
})
