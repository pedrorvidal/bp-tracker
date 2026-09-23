import { describe, expect, it } from 'vitest'
import { categoryCounts, classify } from './bpCategory'

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

describe('categoryCounts', () => {
  it('counts readings per category, using the more severe of the two values', () => {
    expect(
      categoryCounts([
        { systolic: 118, diastolic: 76 },
        { systolic: 115, diastolic: 70 },
        { systolic: 125, diastolic: 75 },
        { systolic: 118, diastolic: 85 },
        { systolic: 150, diastolic: 70 },
      ]),
    ).toEqual({ normal: 2, elevated: 1, stage1: 1, stage2: 1 })
  })

  it('is all zeros for no readings', () => {
    expect(categoryCounts([])).toEqual({
      normal: 0,
      elevated: 0,
      stage1: 0,
      stage2: 0,
    })
  })
})
