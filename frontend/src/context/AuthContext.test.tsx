import { QueryClient } from '@tanstack/react-query'
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { AUTH_STORAGE_KEY, getSession, setSession } from '../lib/authStore'
import { makeSession, makeTokensResponse } from '../test/fixtures'
import { mockApi, restError } from '../test/mockApi'
import { createWrapper, renderWithProviders } from '../test/renderWithProviders'

/** Renders the auth state and buttons driving login/logout. */
function AuthProbe() {
  const { user, isAuthenticated, login, logout } = useAuth()

  return (
    <div>
      <p>status: {isAuthenticated ? 'signed in' : 'signed out'}</p>
      <p>user: {user ? `${user.id}/${user.username}` : 'none'}</p>
      <button type="button" onClick={() => void login('admin', 'secret')}>
        log in
      </button>
      <button type="button" onClick={() => void logout()}>
        log out
      </button>
    </div>
  )
}

const invalidCredentials = restError(
  'bp_tracker_jwt_invalid_credentials',
  'Invalid username or password.',
  403,
)
const expired = restError(
  'bp_tracker_jwt_invalid_token',
  'Invalid or expired access token.',
  401,
)

describe('AuthProvider', () => {
  it('starts signed out when there is no stored session', () => {
    renderWithProviders(<AuthProbe />)

    expect(screen.getByText('status: signed out')).toBeInTheDocument()
    expect(screen.getByText('user: none')).toBeInTheDocument()
  })

  it('restores a stored session', () => {
    setSession(makeSession('a', 5))

    renderWithProviders(<AuthProbe />)

    expect(screen.getByText('status: signed in')).toBeInTheDocument()
    expect(screen.getByText('user: 5/admin')).toBeInTheDocument()
  })

  describe('login', () => {
    it('updates the context and persists the session on success', async () => {
      const response = makeTokensResponse('a', 3)
      const http = mockApi({
        'POST /auth/login': { status: 200, data: response },
      })
      renderWithProviders(<AuthProbe />)

      await userEvent.click(screen.getByRole('button', { name: 'log in' }))

      expect(await screen.findByText('status: signed in')).toBeInTheDocument()
      expect(screen.getByText('user: 3/admin')).toBeInTheDocument()
      expect(http.callsTo('POST /auth/login')[0]?.body).toEqual({
        username: 'admin',
        password: 'secret',
      })

      const stored: unknown = JSON.parse(
        window.localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null',
      )
      expect(stored).toMatchObject({
        tokens: {
          accessToken: response.access_token,
          refreshToken: 'refresh-a',
        },
        user: { id: 3, username: 'admin' },
      })
    })

    it('rejects and stays signed out when the credentials are invalid', async () => {
      mockApi({ 'POST /auth/login': invalidCredentials })
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      })

      await expect(
        act(() => result.current.login('admin', 'wrong')),
      ).rejects.toMatchObject({ response: { status: 403 } })
      expect(result.current.isAuthenticated).toBe(false)
      expect(getSession()).toBeNull()
    })
  })

  describe('logout', () => {
    it('revokes the refresh token on the server and clears the state', async () => {
      const session = makeSession('a')
      setSession(session)
      const http = mockApi({
        'POST /auth/logout': { status: 200, data: { success: true } },
      })
      renderWithProviders(<AuthProbe />)

      await userEvent.click(screen.getByRole('button', { name: 'log out' }))

      expect(await screen.findByText('status: signed out')).toBeInTheDocument()
      expect(screen.getByText('user: none')).toBeInTheDocument()
      expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull()

      const [call] = http.callsTo('POST /auth/logout')
      expect(call?.body).toEqual({ refresh_token: 'refresh-a' })
      expect(call?.authorization).toBe(`Bearer ${session.tokens.accessToken}`)
    })

    it.each([
      ['a server error', restError('internal', 'Boom.', 500)],
      ['a network error', 'network-error' as const],
    ])('still clears the state locally after %s', async (_label, reply) => {
      setSession(makeSession('a'))
      mockApi({ 'POST /auth/logout': reply })
      renderWithProviders(<AuthProbe />)

      await userEvent.click(screen.getByRole('button', { name: 'log out' }))

      expect(await screen.findByText('status: signed out')).toBeInTheDocument()
      expect(getSession()).toBeNull()
    })

    it('with an expired access token, refreshes and revokes the new refresh token', async () => {
      setSession(makeSession('old'))
      const http = mockApi({
        'POST /auth/logout': [
          expired,
          { status: 200, data: { success: true } },
        ],
        'POST /auth/refresh': { status: 200, data: makeTokensResponse('new') },
      })
      renderWithProviders(<AuthProbe />)

      await userEvent.click(screen.getByRole('button', { name: 'log out' }))

      expect(await screen.findByText('status: signed out')).toBeInTheDocument()
      const logouts = http.callsTo('POST /auth/logout')
      expect(logouts).toHaveLength(2)
      expect(logouts[1]?.body).toEqual({ refresh_token: 'refresh-new' })
    })

    it('clears the query cache so the next user never sees stale data', async () => {
      setSession(makeSession('a'))
      mockApi({ 'POST /auth/logout': { status: 200, data: {} } })
      const queryClient = new QueryClient()
      queryClient.setQueryData(['readings'], [{ id: 1 }])
      renderWithProviders(<AuthProbe />, { queryClient })
      expect(queryClient.getQueryData(['readings'])).toEqual([{ id: 1 }])

      await userEvent.click(screen.getByRole('button', { name: 'log out' }))

      await waitFor(() => {
        expect(queryClient.getQueryData(['readings'])).toBeUndefined()
      })
    })
  })

  it('reacts to the session being cleared outside React (failed refresh)', () => {
    setSession(makeSession('a'))
    renderWithProviders(<AuthProbe />)
    expect(screen.getByText('status: signed in')).toBeInTheDocument()

    act(() => {
      setSession(null)
    })

    expect(screen.getByText('status: signed out')).toBeInTheDocument()
  })

  it('useAuth throws outside <AuthProvider>', () => {
    function Orphan() {
      useAuth()
      return null
    }

    expect(() => render(<Orphan />)).toThrow(/inside <AuthProvider>/)
  })
})
