import type { AuthSession, AuthTokens } from '../types'

/**
 * Single source of truth for the signed-in session.
 *
 * Kept in memory and mirrored to localStorage so a reload keeps the user
 * signed in. Both the axios interceptors (which read and rotate tokens) and
 * AuthContext (which subscribes via useSyncExternalStore) go through here,
 * so a failed refresh anywhere signs the user out everywhere.
 */

export const AUTH_STORAGE_KEY = 'bp-tracker.auth'

type Listener = () => void

/** `undefined` until the first read loads it from storage. */
let session: AuthSession | null | undefined
const listeners = new Set<Listener>()

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const { tokens, user } = value as Record<string, unknown>

  if (typeof tokens !== 'object' || tokens === null) {
    return false
  }
  if (typeof user !== 'object' || user === null) {
    return false
  }

  const t = tokens as Record<string, unknown>
  const u = user as Record<string, unknown>

  return (
    typeof t.accessToken === 'string' &&
    typeof t.refreshToken === 'string' &&
    typeof t.expiresAt === 'number' &&
    typeof u.id === 'number' &&
    typeof u.username === 'string'
  )
}

function readStorage(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
    if (raw === null) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)
    return isAuthSession(parsed) ? parsed : null
  } catch {
    // Storage unavailable (private mode, blocked) or corrupted JSON.
    return null
  }
}

function writeStorage(next: AuthSession | null): void {
  try {
    if (next === null) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
    } else {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next))
    }
  } catch {
    // Storage unavailable: the in-memory session still works for this tab.
  }
}

export function getSession(): AuthSession | null {
  if (session === undefined) {
    session = readStorage()
  }
  return session
}

export function setSession(next: AuthSession | null): void {
  session = next
  writeStorage(next)
  listeners.forEach((listener) => listener())
}

/** Replaces the tokens of the current session, keeping its user. No-op when signed out. */
export function updateTokens(tokens: AuthTokens): void {
  const current = getSession()

  if (current !== null) {
    setSession({ ...current, tokens })
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAccessToken(): string | null {
  return getSession()?.tokens.accessToken ?? null
}

export function getRefreshToken(): string | null {
  return getSession()?.tokens.refreshToken ?? null
}
