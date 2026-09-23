import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { getSession, setSession } from '../lib/authStore'
import { makeSession } from '../test/fixtures'
import { deferredReply, mockApi, restError } from '../test/mockApi'
import { renderWithProviders } from '../test/renderWithProviders'
import SignOutEverywhere from './SignOutEverywhere'

function button() {
  return screen.getByRole('button', { name: /sign(ing)? out/i })
}

describe('SignOutEverywhere', () => {
  it('explains what the button does', () => {
    setSession(makeSession('a'))
    renderWithProviders(<SignOutEverywhere />)

    expect(
      screen.getByRole('heading', { name: 'Security' }),
    ).toBeInTheDocument()
    expect(button()).toHaveAccessibleName('Sign out of all devices')
    expect(button()).toHaveAccessibleDescription(/every device and browser/)
  })

  it('revokes every session and signs this tab out', async () => {
    setSession(makeSession('a'))
    const http = mockApi({
      'POST /auth/logout-all': {
        status: 200,
        data: { success: true, revoked_sessions: 3 },
      },
    })
    renderWithProviders(<SignOutEverywhere />)

    await userEvent.click(button())

    expect(http.callsTo('POST /auth/logout-all')[0]).toMatchObject({
      csrf: '1',
      withCredentials: true,
      authorization: undefined,
    })
    expect(getSession()).toBeNull()
  })

  it('disables the button while the request is pending', async () => {
    setSession(makeSession('a'))
    const pending = deferredReply()
    mockApi({ 'POST /auth/logout-all': pending.handler })
    renderWithProviders(<SignOutEverywhere />)

    await userEvent.click(button())

    expect(button()).toHaveTextContent('Signing out…')
    expect(button()).toBeDisabled()
    pending.resolve({ status: 200, data: { success: true } })
  })

  it.each([
    ['a network error', 'network-error' as const],
    ['a server error', restError('internal', 'Boom.', 500)],
  ])(
    'keeps the session and shows an error after %s, so the user can retry',
    async (_label, reply) => {
      setSession(makeSession('a'))
      mockApi({ 'POST /auth/logout-all': reply })
      renderWithProviders(<SignOutEverywhere />)

      await userEvent.click(button())

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not sign out your other devices.',
      )
      expect(getSession()).not.toBeNull()
      expect(button()).toBeEnabled()
    },
  )

  it('ends the local session when the server rejects the refresh cookie', async () => {
    setSession(makeSession('a'))
    mockApi({
      'POST /auth/logout-all': restError(
        'bp_tracker_jwt_invalid_refresh_token',
        'Invalid or expired refresh token.',
        401,
      ),
    })
    renderWithProviders(<SignOutEverywhere />)

    await userEvent.click(button())

    expect(getSession()).toBeNull()
  })

  it('signs out the other open tabs', async () => {
    setSession(makeSession('a'))
    mockApi({ 'POST /auth/logout-all': { status: 200, data: {} } })
    const otherTab = new BroadcastChannel('bp-tracker-auth')
    const received = new Promise<unknown>((resolve) => {
      otherTab.onmessage = (event: MessageEvent) => resolve(event.data)
    })
    renderWithProviders(<SignOutEverywhere />)

    await userEvent.click(button())

    await expect(received).resolves.toEqual({ type: 'logout' })
    otherTab.close()
  })
})
