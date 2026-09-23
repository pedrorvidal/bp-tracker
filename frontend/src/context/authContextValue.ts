import { createContext } from 'react'
import type { User } from '../types'

export interface AuthContextValue {
  user: User | null
  isAuthenticated: boolean
  /** Rejects with the API error when the credentials are invalid. */
  login: (username: string, password: string) => Promise<void>
  /** Revokes the session on the server (best effort) and always clears it locally. */
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
