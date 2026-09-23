import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { getSession, setSession } from './lib/authStore'
import { makeSession } from './test/fixtures'
import { mockApi } from './test/mockApi'
import { renderWithProviders } from './test/renderWithProviders'

function newReadingHeading() {
  return screen.getByRole('heading', { level: 2, name: 'New reading' })
}

describe('App', () => {
  it('renders the app shell with its landmarks', () => {
    renderWithProviders(<App />)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'BP Tracker' }),
    ).toBeInTheDocument()
  })

  it('shows the login page when signed out, without navigation or sign-out', () => {
    renderWithProviders(<App />)

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sign out' }),
    ).not.toBeInTheDocument()
  })

  it.each(['/new', '/history', '/account'])('protects %s', (route) => {
    renderWithProviders(<App />, { route })

    expect(
      screen.getByRole('heading', { level: 2, name: 'Sign in' }),
    ).toBeInTheDocument()
  })

  it('links New reading, History and Account in the main navigation', async () => {
    setSession(makeSession('a'))
    mockApi({
      'GET /readings': {
        status: 200,
        data: [],
        headers: { 'x-wp-totalpages': '0' },
      },
      'GET /stats': {
        status: 200,
        data: {
          count: 0,
          systolic_average: null,
          diastolic_average: null,
          pulse_average: null,
        },
      },
    })
    renderWithProviders(<App />)

    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['New reading', 'History', 'Account'])

    await userEvent.click(within(nav).getByRole('link', { name: 'History' }))

    // The history route is lazy-loaded: allow time for its chunk to import.
    expect(
      await screen.findByRole(
        'heading',
        { level: 2, name: 'History' },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'History' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it.each(['/', '/new', '/does-not-exist'])(
    'shows the new-reading form on %s when signed in',
    (route) => {
      setSession(makeSession('a'))

      renderWithProviders(<App />, { route })

      expect(newReadingHeading()).toBeInTheDocument()
    },
  )

  it('navigates between the new-reading form and the account page', async () => {
    setSession(makeSession('a'))
    renderWithProviders(<App />)

    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New reading' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await userEvent.click(screen.getByRole('link', { name: 'Account' }))

    expect(
      screen.getByRole('heading', { level: 2, name: 'Account' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.getByText('Signed in as Ada Admin (admin)'),
    ).toBeInTheDocument()
  })

  it('offers "Sign out of all devices" on the account page', async () => {
    setSession(makeSession('a'))
    mockApi({
      'POST /auth/logout-all': { status: 200, data: { success: true } },
    })
    renderWithProviders(<App />, { route: '/account' })

    await userEvent.click(
      screen.getByRole('button', { name: 'Sign out of all devices' }),
    )

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Sign in' }),
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
