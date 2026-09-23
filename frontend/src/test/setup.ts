import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { setSession } from '../lib/authStore'
import { restoreApi } from './mockApi'

beforeEach(() => {
  // Start every test signed out and settled. Tests of the session restore on
  // page load call resetAuthStore() to get back to "loading".
  setSession(null)
})

afterEach(async () => {
  // Vitest globals are off, so Testing Library can't register its own cleanup.
  cleanup()
  restoreApi()
  // Let requests settled by restoreApi() finish (including the single-flight
  // refresh's cleanup) before the next test starts.
  await new Promise((resolve) => setTimeout(resolve, 0))
  setSession(null)
  window.localStorage.clear()
})
