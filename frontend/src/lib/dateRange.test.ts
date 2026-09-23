import { describe, expect, it } from 'vitest'
import {
  LIFETIME,
  describeRange,
  lastDays,
  matchPreset,
  parseDateInput,
  presetRange,
  previousRange,
  rangeLengthDays,
  rangeToParams,
} from './dateRange'

// Tests run in America/Sao_Paulo (UTC-3); see vite.config.ts.
const TODAY = new Date(2026, 8, 23, 10, 15)

describe('presets', () => {
  it.each([
    ['7', '2026-09-17'],
    ['10', '2026-09-14'],
    ['30', '2026-08-25'],
    ['90', '2026-06-26'],
  ] as const)('%s days ends today and starts on %s', (id, start) => {
    expect(presetRange(id, TODAY)).toEqual({ start, end: '2026-09-23' })
  })

  it('lifetime has no bounds', () => {
    expect(presetRange('lifetime', TODAY)).toEqual(LIFETIME)
  })

  it('recognises the preset a range stands for', () => {
    expect(matchPreset(lastDays(10, TODAY), TODAY)).toBe('10')
    expect(matchPreset(LIFETIME, TODAY)).toBe('lifetime')
    expect(
      matchPreset({ start: '2026-09-01', end: '2026-09-10' }, TODAY),
    ).toBeNull()
  })
})

describe('rangeToParams', () => {
  it('spans whole local days with the local offset', () => {
    expect(rangeToParams({ start: '2026-09-17', end: '2026-09-23' })).toEqual({
      period_start: '2026-09-17T00:00:00-03:00',
      period_end: '2026-09-23T23:59:59-03:00',
    })
  })

  it('sends nothing for lifetime', () => {
    expect(rangeToParams(LIFETIME)).toEqual({})
  })
})

describe('previousRange', () => {
  it('is the same number of days right before', () => {
    expect(previousRange(lastDays(30, TODAY))).toEqual({
      start: '2026-07-26',
      end: '2026-08-24',
    })
    expect(previousRange({ start: '2026-09-01', end: '2026-09-15' })).toEqual({
      start: '2026-08-17',
      end: '2026-08-31',
    })
  })

  it('handles a single day', () => {
    expect(previousRange({ start: '2026-09-23', end: '2026-09-23' })).toEqual({
      start: '2026-09-22',
      end: '2026-09-22',
    })
  })

  it('is null for lifetime', () => {
    expect(previousRange(LIFETIME)).toBeNull()
  })
})

describe('helpers', () => {
  it('counts days inclusively', () => {
    expect(rangeLengthDays(lastDays(7, TODAY))).toBe(7)
    expect(rangeLengthDays({ start: '2026-02-01', end: '2026-03-01' })).toBe(29)
    expect(rangeLengthDays(LIFETIME)).toBeNull()
  })

  it('parses date inputs strictly', () => {
    expect(parseDateInput('2026-09-23')?.getDate()).toBe(23)
    expect(parseDateInput('2026-02-30')).toBeNull()
    expect(parseDateInput('23/09/2026')).toBeNull()
    expect(parseDateInput('')).toBeNull()
  })

  it('describes ranges', () => {
    expect(describeRange(lastDays(30, TODAY), TODAY)).toBe('last 30 days')
    expect(describeRange(LIFETIME, TODAY)).toBe('all time')
    expect(
      describeRange({ start: '2026-09-01', end: '2026-09-15' }, TODAY),
    ).toBe('Sep 1, 2026 – Sep 15, 2026')
  })
})
