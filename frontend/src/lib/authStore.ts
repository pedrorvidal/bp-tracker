import type { AuthSession, AuthStatus } from '../types'

/**
 * Single source of truth for the signed-in session.
 *
 * Memory only, on purpose: the access token never touches localStorage, and
 * the refresh token lives in an HttpOnly cookie JavaScript can't read. After
 * a reload the session is restored by calling /auth/refresh (see
 * initializeSession() in ./api). Both the axios interceptors and AuthContext
 * (via useSyncExternalStore) go through here, so a failed refresh anywhere
 * signs the user out everywhere.
 */

export interface AuthState {
  status: AuthStatus
  session: AuthSession | null
}

/** Where earlier versions kept both tokens; purged on load. */
export const LEGACY_STORAGE_KEY = 'bp-tracker.auth'

type Listener = () => void

let state: AuthState = { status: 'loading', session: null }
const listeners = new Set<Listener>()

function emit(next: AuthState): void {
  state = next
  listeners.forEach((listener) => listener())
}

/** Removes tokens persisted by earlier versions, which kept them in localStorage. */
export function purgeLegacyStorage(): void {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Storage unavailable: nothing to purge.
  }
}

purgeLegacyStorage()

/** The current state. Same object until it changes (safe for useSyncExternalStore). */
export function getAuthState(): AuthState {
  return state
}

export function getSession(): AuthSession | null {
  return state.session
}

export function setSession(session: AuthSession | null): void {
  emit({
    status: session ? 'authenticated' : 'unauthenticated',
    session,
  })
}

/** Back to the initial "restoring the session" state. */
export function resetAuthStore(): void {
  emit({ status: 'loading', session: null })
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAccessToken(): string | null {
  return state.session?.tokens.accessToken ?? null
}
