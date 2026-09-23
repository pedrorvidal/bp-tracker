import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockMediaQueries } from '../test/colorScheme'
import { useMediaQuery } from './useMediaQuery'
import { usePrefersDark } from './usePrefersDark'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePrefersDark', () => {
  it('is false where matchMedia is unavailable (e.g. jsdom)', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => usePrefersDark())
    expect(result.current).toBe(false)
  })

  it('follows prefers-color-scheme and updates live', () => {
    const media = mockMediaQueries({ dark: false })
    const { result } = renderHook(() => usePrefersDark())
    expect(result.current).toBe(false)

    act(() => media.setDark(true))
    expect(result.current).toBe(true)

    act(() => media.setDark(false))
    expect(result.current).toBe(false)
  })
})

describe('useMediaQuery', () => {
  it('follows a width query and updates live', () => {
    const media = mockMediaQueries({ wide: false })
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(result.current).toBe(false)

    act(() => media.setWide(true))
    expect(result.current).toBe(true)
  })
})
