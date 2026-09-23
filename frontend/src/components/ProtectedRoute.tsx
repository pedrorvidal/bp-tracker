import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import SessionLoading from './SessionLoading'

export const LOGIN_PATH = '/login'

interface ProtectedRouteProps {
  /** Content to protect. Omit to use as a layout route (renders <Outlet />). */
  children?: ReactNode
}

/**
 * Renders its content only for signed-in users; otherwise redirects to the
 * login page, remembering where the user was headed. While the session is
 * still being restored after a page load, shows a loading state instead of
 * redirecting.
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <SessionLoading />
  }

  if (status !== 'authenticated') {
    return <Navigate to={LOGIN_PATH} replace state={{ from: location }} />
  }

  return children ?? <Outlet />
}
