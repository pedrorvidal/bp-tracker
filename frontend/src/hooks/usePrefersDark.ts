import { useMediaQuery } from './useMediaQuery'

/** Whether the OS/browser asks for a dark color scheme, updated live. */
export function usePrefersDark(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)')
}
