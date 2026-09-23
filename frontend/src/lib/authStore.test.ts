import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '../test/fixtures'
import {
  AUTH_STORAGE_KEY,
  getAccessToken,
  getRefreshToken,
  getSession,
  setSession,
  subscribe,
  updateTokens,
} from './authStore'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

/** Loads a fresh copy of the store, as on a page reload. */
async function reloadStore() {
  vi.resetModules()
  return import('./authStore')
}

describe('authStore', () => {
  it('starts signed out when nothing is stored', () => {
    expect(getSession()).toBeNull()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('exposes the tokens of the current session', () => {
    const session = makeSession('a')
    setSession(session)

    expect(getSession()).toEqual(session)
    expect(getAccessToken()).toBe(session.tokens.accessToken)
    expect(getRefreshToken()).toBe('refresh-a')
  })

  it('persists the session to localStorage and clears it on sign-out', () => {
    const session = makeSession('a')

    setSession(session)
    expect(
      JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null'),
    ).toEqual(session)

    setSession(null)
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()
  })

  it('restores a persisted session after a reload', async () => {
    const session = makeSession('a')
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))

    const store = await reloadStore()

    expect(store.getSession()).toEqual(session)
    expect(store.getRefreshToken()).toBe('refresh-a')
  })

  it.each([
    ['corrupted JSON', '{not json'],
    ['wrong shape', JSON.stringify({ accessToken: 'x' })],
    [
      'wrong field types',
      JSON.stringify({
        tokens: { accessToken: 1, refreshToken: 'r', expiresAt: 0 },
        user: { id: 1, username: 'a' },
      }),
    ],
    ['null', 'null'],
  ])('ignores %s in storage', async (_label, raw) => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, raw)

    const store = await reloadStore()

    expect(store.getSession()).toBeNull()
  })

  it('keeps working in memory when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const store = await reloadStore()
    const session = makeSession('a')

    expect(store.getSession()).toBeNull()
    store.setSession(session)
    expect(store.getSession()).toEqual(session)
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

  it('updateTokens replaces the tokens and keeps the user', () => {
    const session = makeSession('a', 7)
    setSession(session)
    const tokens = makeSession('b').tokens

    updateTokens(tokens)

    expect(getSession()).toEqual({ tokens, user: session.user })
  })

  it('updateTokens does nothing when signed out', () => {
    updateTokens(makeSession('b').tokens)

    expect(getSession()).toBeNull()
  })
})
