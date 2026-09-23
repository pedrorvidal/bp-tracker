import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { getSession, setSession } from '../lib/authStore'
import { makeSession, makeTokensResponse } from '../test/fixtures'
import { mockApi, restError, type MockReply } from '../test/mockApi'
import { renderWithProviders } from '../test/renderWithProviders'
import Login from './Login'

function renderLogin(route = '/login', state?: unknown) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<h1>Home page</h1>} />
      <Route path="/history" element={<h1>History page</h1>} />
    </Routes>,
    { route: state === undefined ? route : { pathname: route, state } },
  )
}

async function submit(username = 'admin', password = 'secret') {
  await userEvent.type(screen.getByLabelText('Username or email'), username)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('Login page', () => {
  it('labels every field and uses password-manager friendly autocomplete', () => {
    renderLogin()

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Username or email')).toHaveAttribute(
      'autocomplete',
      'username',
    )
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
  })

  it('signs in and redirects home on success', async () => {
    const http = mockApi({
      'POST /auth/login': { status: 200, data: makeTokensResponse('a') },
    })
    renderLogin()

    await submit('admin', 'secret')

    expect(
      await screen.findByRole('heading', { name: 'Home page' }),
    ).toBeInTheDocument()
    expect(http.callsTo('POST /auth/login')[0]?.body).toEqual({
      username: 'admin',
      password: 'secret',
    })
    expect(getSession()?.user.username).toBe('admin')
  })

  it('returns to the page the user was sent away from', async () => {
    mockApi({
      'POST /auth/login': { status: 200, data: makeTokensResponse('a') },
    })
    renderLogin('/login', { from: { pathname: '/history' } })

    await submit()

    expect(
      await screen.findByRole('heading', { name: 'History page' }),
    ).toBeInTheDocument()
  })

  it('ignores a redirect target that is not an internal path', async () => {
    mockApi({
      'POST /auth/login': { status: 200, data: makeTokensResponse('a') },
    })
    renderLogin('/login', { from: { pathname: '//evil.example/x' } })

    await submit()

    expect(
      await screen.findByRole('heading', { name: 'Home page' }),
    ).toBeInTheDocument()
  })

  it('shows an error and stays on the page when the credentials are invalid', async () => {
    mockApi({
      'POST /auth/login': restError(
        'bp_tracker_jwt_invalid_credentials',
        'Invalid username or password.',
        403,
      ),
    })
    renderLogin()

    await submit('admin', 'wrong')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid username or password.',
    )
    expect(screen.getByRole('form')).toHaveAccessibleDescription(
      'Invalid username or password.',
    )
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    expect(screen.getByLabelText('Username or email')).toHaveValue('admin')
    expect(getSession()).toBeNull()
  })

  it.each<[string, MockReply]>([
    ['a network error', 'network-error'],
    ['a server error', restError('internal', 'Boom.', 500)],
  ])('shows a generic error after %s', async (_label, reply) => {
    mockApi({ 'POST /auth/login': reply })
    renderLogin()

    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign in.',
    )
  })

  it('clears the previous error when submitting again', async () => {
    mockApi({
      'POST /auth/login': [
        restError('bp_tracker_jwt_invalid_credentials', 'Invalid.', 403),
        { status: 200, data: makeTokensResponse('a') },
      ],
    })
    renderLogin()

    await submit('admin', 'wrong')
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Password'))
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(
      await screen.findByRole('heading', { name: 'Home page' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the button while signing in', async () => {
    let finish: (reply: MockReply) => void = () => undefined
    mockApi({
      'POST /auth/login': () =>
        new Promise<MockReply>((resolve) => {
          finish = resolve
        }),
    })
    renderLogin()

    await submit()

    const button = screen.getByRole('button', { name: 'Signing in…' })
    expect(button).toBeDisabled()

    finish({ status: 200, data: makeTokensResponse('a') })
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Home page' }),
      ).toBeInTheDocument()
    })
  })

  it('redirects away when already signed in', () => {
    setSession(makeSession('a'))

    renderLogin()

    expect(
      screen.getByRole('heading', { name: 'Home page' }),
    ).toBeInTheDocument()
  })
})
