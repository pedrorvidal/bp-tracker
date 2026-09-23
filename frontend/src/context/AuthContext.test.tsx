import { QueryClient } from '@tanstack/react-query'
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { getAuthState, resetAuthStore, setSession } from '../lib/authStore'
import { makeSession, makeTokensResponse } from '../test/fixtures'
import {
  deferredReply,
  mockApi,
  restError,
  type MockReply,
} from '../test/mockApi'
import { createWrapper, renderWithProviders } from '../test/renderWithProviders'

/** Renders the auth state and buttons driving login/logout. */
function AuthProbe() {
  const { status, user, login, logout } = useAuth()

  return (
    <div>
      <p>status: {status}</p>
      <p>user: {user ? `${user.id}/${user.displayName}` : 'none'}</p>
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AuthProvider', () => {
  describe('on page load', () => {
    it('shows "loading", then restores the session from the refresh cookie', async () => {
      resetAuthStore()
      const pending = deferredReply()
      const http = mockApi({
        'POST /auth/refresh': pending.handler,
      })

      renderWithProviders(<AuthProbe />)
      expect(screen.getByText('status: loading')).toBeInTheDocument()

      pending.resolve({ status: 200, data: makeTokensResponse('a', 5) })

      expect(
        await screen.findByText('status: authenticated'),
      ).toBeInTheDocument()
      expect(screen.getByText('user: 5/Ada Admin')).toBeInTheDocument()
      expect(http.calls[0]).toMatchObject({ csrf: '1', withCredentials: true })
    })

    it('ends signed out when there is no valid refresh cookie', async () => {
      resetAuthStore()
      mockApi({
        'POST /auth/refresh': restError(
          'bp_tracker_jwt_invalid_refresh_token',
          'Invalid or expired refresh token.',
          401,
        ),
      })

      renderWithProviders(<AuthProbe />)

      expect(
        await screen.findByText('status: unauthenticated'),
      ).toBeInTheDocument()
    })
  })

  describe('login', () => {
    it('updates the context on success, without storing any token', async () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      const http = mockApi({
        'POST /auth/login': { status: 200, data: makeTokensResponse('a', 3) },
      })
      renderWithProviders(<AuthProbe />)

      await userEvent.click(screen.getByRole('button', { name: 'log in' }))

      expect(
        await screen.findByText('status: authenticated'),
      ).toBeInTheDocument()
      expect(screen.getByText('user: 3/Ada Admin')).toBeInTheDocument()
      expect(http.callsTo('POST /auth/login')[0]).toMatchObject({
        body: { username: 'admin', password: 'secret' },
        csrf: '1',
        withCredentials: true,
        authorization: undefined,
      })
      expect(setItem).not.toHaveBeenCalled()
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
      expect(getAuthState().session).toBeNull()
    })
  })

  describe('logout', () => {
    it('revokes the refresh cookie on the server and clears the state', async () => {
      setSession(makeSession('a'))
      const http = mockApi({
        'POST /auth/logout': { status: 200, data: { success: true } },
      })
      renderWithProviders(<AuthProbe />)

      await userEvent.click(screen.getByRole('button', { name: 'log out' }))

      expect(
        await screen.findByText('status: unauthenticated'),
      ).toBeInTheDocument()
      expect(screen.getByText('user: none')).toBeInTheDocument()
      // The cookie identifies the session; no Bearer (it may have expired).
      expect(http.callsTo('POST /auth/logout')[0]).toMatchObject({
        body: undefined,
        csrf: '1',
        withCredentials: true,
        authorization: undefined,
      })
    })

    it.each<[string, MockReply]>([
      ['a server error', restError('internal', 'Boom.', 500)],
      ['a network error', 'network-error'],
    ])('still clears the state locally after %s', async (_label, reply) => {
      setSession(makeSession('a'))
      mockApi({ 'POST /auth/logout': reply })
      renderWithProviders(<AuthProbe />)

      await userEvent.click(screen.getByRole('button', { name: 'log out' }))

      expect(
        await screen.findByText('status: unauthenticated'),
      ).toBeInTheDocument()
    })

    it('tells other tabs to sign out', async () => {
      setSession(makeSession('a'))
      mockApi({ 'POST /auth/logout': { status: 200, data: {} } })
      const otherTab = new BroadcastChannel('bp-tracker-auth')
      const received = new Promise<unknown>((resolve) => {
        otherTab.onmessage = (event: MessageEvent) => resolve(event.data)
      })
      renderWithProviders(<AuthProbe />)

      await userEvent.click(screen.getByRole('button', { name: 'log out' }))

      await expect(received).resolves.toEqual({ type: 'logout' })
      otherTab.close()
    })

    it('signs out when another tab signs out', async () => {
      setSession(makeSession('a'))
      renderWithProviders(<AuthProbe />)
      expect(screen.getByText('status: authenticated')).toBeInTheDocument()

      const otherTab = new BroadcastChannel('bp-tracker-auth')
      otherTab.postMessage({ type: 'logout' })
      otherTab.close()

      expect(
        await screen.findByText('status: unauthenticated'),
      ).toBeInTheDocument()
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
    expect(screen.getByText('status: authenticated')).toBeInTheDocument()

    act(() => {
      setSession(null)
    })

    expect(screen.getByText('status: unauthenticated')).toBeInTheDocument()
  })

  it('useAuth throws outside <AuthProvider>', () => {
    function Orphan() {
      useAuth()
      return null
    }

    expect(() => render(<Orphan />)).toThrow(/inside <AuthProvider>/)
  })
})
