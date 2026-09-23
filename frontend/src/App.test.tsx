import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'
import { createQueryClient } from './lib/queryClient'

function renderApp(route = '/') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('App', () => {
  it('renders the app shell with its landmarks', () => {
    renderApp()

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'BP Tracker' }),
    ).toBeInTheDocument()
  })

  it('renders the home page on "/"', () => {
    renderApp('/')

    expect(
      screen.getByRole('heading', { level: 2, name: 'Welcome' }),
    ).toBeInTheDocument()
  })
})
