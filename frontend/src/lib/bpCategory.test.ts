import { describe, expect, it } from 'vitest'
import { DIASTOLIC_ZONES, SYSTOLIC_ZONES, classify } from './bpCategory'

describe('classify (2017 ACC/AHA categories)', () => {
  it.each([
    [118, 76, 'normal'],
    [119, 79, 'normal'],
    [120, 79, 'elevated'],
    [129, 70, 'elevated'],
    [130, 70, 'stage1'],
    [139, 89, 'stage1'],
    [118, 80, 'stage1'], // diastolic alone
    [118, 89, 'stage1'],
    [140, 70, 'stage2'],
    [118, 90, 'stage2'], // diastolic alone
    [125, 95, 'stage2'], // the higher category wins
  ])('%i/%i is %s', (systolic, diastolic, expected) => {
    expect(classify(systolic, diastolic)).toBe(expected)
  })
})

describe('zones', () => {
  it('cover the whole axis without gaps or overlaps', () => {
    for (const zones of [SYSTOLIC_ZONES, DIASTOLIC_ZONES]) {
      expect(zones[0]?.from).toBeNull()
      expect(zones[zones.length - 1]?.to).toBeNull()
      zones.slice(1).forEach((zone, i) => {
        expect(zone.from).toBe(zones[i]?.to)
      })
    }
  })

  it('have no "elevated" band for diastolic (it is defined by systolic only)', () => {
    expect(DIASTOLIC_ZONES.map((z) => z.category)).toEqual([
      'normal',
      'stage1',
      'stage2',
    ])
  })
})
