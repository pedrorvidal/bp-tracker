import { vi } from 'vitest'

/**
 * Installs a controllable matchMedia: (prefers-color-scheme: dark) follows
 * `dark`, (min-width: …) queries follow `wide`. Returns setters that notify
 * listeners, like a real theme or window change.
 */
export function mockMediaQueries({
  dark = false,
  wide = false,
}: { dark?: boolean; wide?: boolean } = {}) {
  const state = { dark, wide }
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('prefers-color-scheme: dark')
        ? state.dark
        : query.includes('min-width')
          ? state.wide
          : false
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }))
  const notify = () => listeners.forEach((cb) => cb())
  return {
    setDark(next: boolean) {
      state.dark = next
      notify()
    },
    setWide(next: boolean) {
      state.wide = next
      notify()
    },
  }
}

/** Shorthand: only the color scheme. */
export function mockColorScheme(dark: boolean) {
  const media = mockMediaQueries({ dark })
  return { set: (next: boolean) => media.setDark(next) }
}
