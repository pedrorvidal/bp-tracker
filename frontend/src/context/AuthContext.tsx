import { useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { initializeSession } from '../lib/api'
import * as authApi from '../lib/authApi'
import { getAuthState, subscribe } from '../lib/authStore'
import { AuthContext, type AuthContextValue } from './authContextValue'

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Exposes the current session and login/logout to the tree.
 *
 * On mount it restores the session from the HttpOnly refresh cookie. The
 * session itself lives in lib/authStore, so changes made outside React (the
 * axios interceptor clearing it after a failed refresh, another tab signing
 * out) re-render every consumer, and ProtectedRoute sends the user back to
 * the login page.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const { status, session } = useSyncExternalStore(subscribe, getAuthState)
  const queryClient = useQueryClient()

  useEffect(() => {
    void initializeSession()
    return authApi.listenForLogoutInOtherTabs()
  }, [])

  // Never let cached data from one session leak into the next.
  useEffect(() => {
    if (status === 'unauthenticated') {
      queryClient.clear()
    }
  }, [status, queryClient])

  const login = useCallback(async (username: string, password: string) => {
    await authApi.login(username, password)
  }, [])

  const logout = useCallback(() => authApi.logout(), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      isAuthenticated: status === 'authenticated',
      login,
      logout,
    }),
    [status, session, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
