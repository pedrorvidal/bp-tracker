import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export const LOGIN_PATH = '/login'

interface ProtectedRouteProps {
  /** Content to protect. Omit to use as a layout route (renders <Outlet />). */
  children?: ReactNode
}

/**
 * Renders its content only for signed-in users; otherwise redirects to the
 * login page, remembering where the user was headed.
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to={LOGIN_PATH} replace state={{ from: location }} />
  }

  return children ?? <Outlet />
}
