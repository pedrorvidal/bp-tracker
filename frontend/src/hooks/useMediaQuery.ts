import { useCallback, useSyncExternalStore } from 'react'

function media(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null
}

/**
 * Whether a CSS media query matches, updated live. For what can't use
 * Tailwind variants, like props passed to Recharts. False where matchMedia
 * is unavailable (e.g. jsdom).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = media(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => media(query)?.matches ?? false,
    () => false,
  )
}
