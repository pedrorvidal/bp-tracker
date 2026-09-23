import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { setSession } from '../lib/authStore'
import { restoreApi } from './mockApi'

afterEach(() => {
  // Vitest globals are off, so Testing Library can't register its own cleanup.
  cleanup()
  restoreApi()
  setSession(null)
  window.localStorage.clear()
})
