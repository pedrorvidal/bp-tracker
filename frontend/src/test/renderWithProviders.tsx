import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter, type InitialEntry } from 'react-router-dom'
import { AuthProvider } from '../context/AuthContext'

interface Options {
  /** Initial URL, or a location with state. */
  route?: InitialEntry
  queryClient?: QueryClient
}

/** A wrapper with the same providers as main.tsx and an in-memory router. */
/** A query client for tests: no retries, so error states show up at once. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

export function createWrapper({
  route = '/',
  queryClient = createTestQueryClient(),
}: Options = {}) {
  return function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

/** Renders UI inside the app's providers. */
export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  return render(ui, { wrapper: createWrapper(options) })
}
