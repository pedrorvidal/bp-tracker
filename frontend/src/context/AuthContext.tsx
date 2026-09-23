import { useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import * as authApi from '../lib/authApi'
import { getSession, subscribe } from '../lib/authStore'
import { AuthContext, type AuthContextValue } from './authContextValue'

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Exposes the current session and login/logout to the tree.
 *
 * The session itself lives in lib/authStore, so changes made outside React
 * (e.g. the axios interceptor clearing it after a failed refresh) re-render
 * every consumer, and ProtectedRoute sends the user back to the login page.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const queryClient = useQueryClient()

  // Never let cached data from one session leak into the next.
  useEffect(() => {
    if (session === null) {
      queryClient.clear()
    }
  }, [session, queryClient])

  const login = useCallback(async (username: string, password: string) => {
    await authApi.login(username, password)
  }, [])

  const logout = useCallback(() => authApi.logout(), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      isAuthenticated: session !== null,
      login,
      logout,
    }),
    [session, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
