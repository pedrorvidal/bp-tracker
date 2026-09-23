import { describe, expect, it } from 'vitest'
import { lastDays, periodParams } from './period'

// Tests run in America/Sao_Paulo (UTC-3); see vite.config.ts.
const NOW = new Date(2026, 8, 23, 10, 15)

describe('lastDays', () => {
  it('covers whole local days, today included', () => {
    expect(periodParams(lastDays(7, NOW))).toEqual({
      period_start: '2026-09-17T00:00:00-03:00',
      period_end: '2026-09-23T23:59:59-03:00',
    })
    expect(periodParams(lastDays(30, NOW))).toEqual({
      period_start: '2026-08-25T00:00:00-03:00',
      period_end: '2026-09-23T23:59:59-03:00',
    })
  })

  it('crosses month boundaries', () => {
    expect(
      periodParams(lastDays(7, new Date(2026, 2, 2, 8, 0))).period_start,
    ).toBe('2026-02-24T00:00:00-03:00')
  })

  it('is stable for the whole day (stable query keys)', () => {
    const morning = periodParams(lastDays(7, new Date(2026, 8, 23, 0, 1)))
    const night = periodParams(lastDays(7, new Date(2026, 8, 23, 23, 58)))

    expect(night).toEqual(morning)
  })
})
