import { describe, expect, it } from 'vitest'
import { manyReadings } from '../test/fixtures'
import type { Reading } from '../types'
import {
  AGGREGATE_THRESHOLD,
  chartPoints,
  dailyAverages,
  rawPoints,
} from './aggregate'

function reading(
  id: number,
  when: string,
  systolic: number,
  diastolic: number,
  pulse: number | null = null,
): Reading {
  return {
    id,
    reading_datetime: when,
    systolic,
    diastolic,
    pulse,
    weight: null,
    notes: '',
  }
}

describe('rawPoints', () => {
  it('keeps every reading, oldest first', () => {
    const points = rawPoints([
      reading(2, '2026-09-20T21:00:00-03:00', 134, 86),
      reading(1, '2026-09-20T08:00:00-03:00', 118, 75, 70),
    ])

    expect(points.map((p) => [p.systolic, p.count, p.aggregated])).toEqual([
      [118, 1, false],
      [134, 1, false],
    ])
  })
})

describe('dailyAverages', () => {
  it('averages each local day (one decimal), pulse only where recorded', () => {
    const points = dailyAverages([
      reading(1, '2026-09-20T08:00:00-03:00', 118, 75, 70),
      reading(2, '2026-09-20T21:00:00-03:00', 134, 86),
      reading(3, '2026-09-20T23:30:00-03:00', 125, 80, 65),
      reading(4, '2026-09-21T07:00:00-03:00', 121, 79),
    ])

    expect(points).toHaveLength(2)
    expect(points[0]).toMatchObject({
      systolic: 125.7,
      diastolic: 80.3,
      pulse: 67.5,
      count: 3,
      aggregated: true,
    })
    expect(points[1]).toMatchObject({ systolic: 121, pulse: null, count: 1 })
  })

  it('groups by local day, not UTC day', () => {
    // 23:30 in São Paulo is already the next day in UTC.
    const points = dailyAverages([
      reading(1, '2026-09-20T08:00:00-03:00', 120, 80),
      reading(2, '2026-09-20T23:30:00-03:00', 130, 90),
    ])

    expect(points).toHaveLength(1)
    expect(new Date(points[0]?.time ?? 0).getDate()).toBe(20)
  })
})

describe('chartPoints', () => {
  it(`keeps raw points up to ${AGGREGATE_THRESHOLD} readings`, () => {
    const result = chartPoints(manyReadings(AGGREGATE_THRESHOLD), false)

    expect(result.aggregated).toBe(false)
    expect(result.points).toHaveLength(AGGREGATE_THRESHOLD)
  })

  it(`aggregates by day above ${AGGREGATE_THRESHOLD} readings`, () => {
    const result = chartPoints(manyReadings(AGGREGATE_THRESHOLD + 2, 3), false)

    expect(result.aggregated).toBe(true)
    expect(result.points).toHaveLength(34) // 102 readings, 3 per day
  })

  it('shows every reading when asked, even above the threshold', () => {
    const result = chartPoints(manyReadings(150), true)

    expect(result.aggregated).toBe(false)
    expect(result.points).toHaveLength(150)
  })
})
