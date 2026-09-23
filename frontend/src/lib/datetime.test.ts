import { describe, expect, it } from 'vitest'
import {
  parseDateTimeLocal,
  toDateTimeLocalValue,
  toIsoWithOffset,
} from './datetime'

describe('datetime helpers (tests run in America/Sao_Paulo, UTC-3)', () => {
  it('runs in the expected time zone', () => {
    expect(new Date(2026, 8, 23, 14, 30).getTimezoneOffset()).toBe(180)
  })

  it('formats a Date as a datetime-local value in local time', () => {
    expect(toDateTimeLocalValue(new Date(2026, 0, 5, 7, 3, 59))).toBe(
      '2026-01-05T07:03',
    )
  })

  it('parses a datetime-local value as local time', () => {
    expect(parseDateTimeLocal('2026-09-23T14:30')?.getTime()).toBe(
      new Date(2026, 8, 23, 14, 30).getTime(),
    )
    expect(parseDateTimeLocal('2026-09-23T14:30:15')?.getSeconds()).toBe(15)
  })

  it.each([
    '',
    'yesterday',
    '2026-09-23',
    '2026-02-30T10:00',
    '2026-09-23T25:00',
  ])('rejects %j', (value) => {
    expect(parseDateTimeLocal(value)).toBeNull()
  })

  it('formats ISO 8601 with the local offset, keeping the wall-clock time', () => {
    const date = new Date(2026, 8, 23, 14, 30, 0)

    expect(toIsoWithOffset(date)).toBe('2026-09-23T14:30:00-03:00')
    expect(new Date(toIsoWithOffset(date)).getTime()).toBe(date.getTime())
  })

  it('round-trips input value -> ISO -> same instant', () => {
    const date = parseDateTimeLocal('2026-12-31T23:59')

    expect(date).not.toBeNull()
    expect(new Date(toIsoWithOffset(date as Date)).toISOString()).toBe(
      '2027-01-01T02:59:00.000Z',
    )
  })
})
