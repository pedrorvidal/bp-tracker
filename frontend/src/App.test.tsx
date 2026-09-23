import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { getSession, setSession } from './lib/authStore'
import { makeSession } from './test/fixtures'
import { mockApi } from './test/mockApi'
import { renderWithProviders } from './test/renderWithProviders'

describe('App', () => {
  it('renders the app shell with its landmarks', () => {
    renderWithProviders(<App />)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'BP Tracker' }),
    ).toBeInTheDocument()
  })

  it('shows the login page on "/" when signed out, without a sign-out button', () => {
    renderWithProviders(<App />)

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sign out' }),
    ).not.toBeInTheDocument()
  })

  it('shows the home page when signed in', () => {
    setSession(makeSession('a'))

    renderWithProviders(<App />)

    expect(
      screen.getByRole('heading', { level: 2, name: 'Welcome, Ada Admin' }),
    ).toBeInTheDocument()
  })

  it('redirects unknown paths home', () => {
    setSession(makeSession('a'))

    renderWithProviders(<App />, { route: '/does-not-exist' })

    expect(
      screen.getByRole('heading', { level: 2, name: 'Welcome, Ada Admin' }),
    ).toBeInTheDocument()
  })

  it('signs out from the header and returns to the login page', async () => {
    setSession(makeSession('a'))
    mockApi({ 'POST /auth/logout': { status: 200, data: { success: true } } })
    renderWithProviders(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(getSession()).toBeNull()
  })
})
