import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { api } from '../lib/api'
import { resetAuthStore, setSession } from '../lib/authStore'
import Login from '../pages/Login'
import { makeSession, makeTokensResponse } from '../test/fixtures'
import { deferredReply, mockApi, restError } from '../test/mockApi'
import { renderWithProviders } from '../test/renderWithProviders'
import ProtectedRoute from './ProtectedRoute'

/** Exposes the current URL path, to catch redirects that happen and revert. */
function LocationProbe() {
  return <span data-testid="path">{useLocation().pathname}</span>
}

function renderRoutes(route: string) {
  return renderWithProviders(
    <>
      <LocationProbe />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<h1>Home page</h1>} />
          <Route path="/history" element={<h1>History page</h1>} />
        </Route>
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <h1>Settings page</h1>
            </ProtectedRoute>
          }
        />
      </Routes>
    </>,
    { route },
  )
}

describe('ProtectedRoute', () => {
  it('redirects to the login page when not authenticated', () => {
    renderRoutes('/history')

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'History page' }),
    ).not.toBeInTheDocument()
  })

  it('also protects content passed as children', () => {
    renderRoutes('/settings')

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Settings page' }),
    ).not.toBeInTheDocument()
  })

  it('waits for the session to be restored instead of redirecting', async () => {
    resetAuthStore()
    const pending = deferredReply()
    mockApi({
      'POST /auth/refresh': pending.handler,
    })
    renderRoutes('/history')

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.getByTestId('path')).toHaveTextContent('/history')

    pending.resolve({ status: 200, data: makeTokensResponse('a') })

    expect(
      await screen.findByRole('heading', { name: 'History page' }),
    ).toBeInTheDocument()
  })

  it('redirects once the restore finds no session', async () => {
    resetAuthStore()
    mockApi({
      'POST /auth/refresh': restError(
        'bp_tracker_jwt_invalid_refresh_token',
        'Invalid or expired refresh token.',
        401,
      ),
    })
    renderRoutes('/history')

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument()
  })

  it('renders the protected page when authenticated', () => {
    setSession(makeSession('a'))

    renderRoutes('/history')

    expect(
      screen.getByRole('heading', { name: 'History page' }),
    ).toBeInTheDocument()
  })

  it('sends the user back to the requested page after signing in', async () => {
    mockApi({
      'POST /auth/login': { status: 200, data: makeTokensResponse('a') },
    })
    renderRoutes('/history')

    await userEvent.type(screen.getByLabelText('Username or email'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByRole('heading', { name: 'History page' }),
    ).toBeInTheDocument()
  })

  it('redirects to the login page when a refresh fails mid-session', async () => {
    setSession(makeSession('old'))
    mockApi({
      'GET /readings': restError(
        'bp_tracker_jwt_invalid_token',
        'Invalid or expired access token.',
        401,
      ),
      'POST /auth/refresh': restError(
        'bp_tracker_jwt_invalid_refresh_token',
        'Invalid or expired refresh token.',
        401,
      ),
    })
    renderRoutes('/history')
    expect(
      screen.getByRole('heading', { name: 'History page' }),
    ).toBeInTheDocument()

    await act(async () => {
      await api.get('/readings').catch(() => undefined)
    })

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'History page' }),
    ).not.toBeInTheDocument()
  })
})
