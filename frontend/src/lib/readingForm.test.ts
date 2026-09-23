import { describe, expect, it } from 'vitest'
import { validateReading, type ReadingFormValues } from './readingForm'

function values(overrides: Partial<ReadingFormValues> = {}): ReadingFormValues {
  return {
    reading_datetime: '2026-09-23T08:30',
    systolic: '118',
    diastolic: '76',
    pulse: '',
    weight: '',
    notes: '',
    ...overrides,
  }
}

function errorsOf(overrides: Partial<ReadingFormValues>) {
  const result = validateReading(values(overrides))
  return 'errors' in result ? result.errors : {}
}

describe('validateReading', () => {
  it('builds the API payload, omitting empty optional fields', () => {
    expect(validateReading(values())).toEqual({
      input: {
        reading_datetime: '2026-09-23T08:30:00-03:00',
        systolic: 118,
        diastolic: 76,
      },
    })
  })

  it('includes optional fields when given, trimming notes and accepting a decimal comma', () => {
    expect(
      validateReading(
        values({ pulse: ' 65 ', weight: '72,5', notes: '  After coffee  ' }),
      ),
    ).toEqual({
      input: {
        reading_datetime: '2026-09-23T08:30:00-03:00',
        systolic: 118,
        diastolic: 76,
        pulse: 65,
        weight: 72.5,
        notes: 'After coffee',
      },
    })
  })

  it.each([
    ['59', 'Systolic must be between 60 and 250.'],
    ['251', 'Systolic must be between 60 and 250.'],
    ['', 'Enter the systolic value.'],
    ['12a', 'Systolic must be a whole number.'],
    ['118.5', 'Systolic must be a whole number.'],
  ])('systolic %j -> %s', (systolic, message) => {
    expect(errorsOf({ systolic }).systolic).toBe(message)
  })

  it('accepts the systolic and diastolic bounds', () => {
    expect(
      validateReading(values({ systolic: '250', diastolic: '40' })),
    ).toHaveProperty('input')
    expect(
      validateReading(values({ systolic: '151', diastolic: '150' })),
    ).toHaveProperty('input')
    expect(errorsOf({ systolic: '60', diastolic: '59' })).toEqual({})
  })

  it.each([
    ['39', 'Diastolic must be between 40 and 150.'],
    ['151', 'Diastolic must be between 40 and 150.'],
    ['', 'Enter the diastolic value.'],
  ])('diastolic %j -> %s', (diastolic, message) => {
    expect(errorsOf({ systolic: '200', diastolic }).diastolic).toBe(message)
  })

  it('rejects systolic not higher than diastolic (swapped values)', () => {
    expect(errorsOf({ systolic: '76', diastolic: '118' }).systolic).toBe(
      'Systolic must be higher than diastolic.',
    )
    expect(errorsOf({ systolic: '90', diastolic: '90' }).systolic).toBe(
      'Systolic must be higher than diastolic.',
    )
  })

  it.each([
    ['29', 'Pulse must be between 30 and 220.'],
    ['221', 'Pulse must be between 30 and 220.'],
  ])('pulse %j -> %s', (pulse, message) => {
    expect(errorsOf({ pulse }).pulse).toBe(message)
  })

  it.each(['0', '-3', 'abc', '72.5.1'])('rejects weight %j', (weight) => {
    expect(errorsOf({ weight }).weight).toBe(
      'Weight must be a positive number, e.g. 72.5.',
    )
  })

  it.each([
    ['', 'Enter the date and time of the reading.'],
    ['2026-02-30T10:00', 'Enter a valid date and time.'],
  ])('reading_datetime %j -> %s', (reading_datetime, message) => {
    expect(errorsOf({ reading_datetime }).reading_datetime).toBe(message)
  })

  it('reports every invalid field at once', () => {
    expect(
      Object.keys(
        errorsOf({ systolic: '300', diastolic: '10', pulse: '5' }),
      ).sort(),
    ).toEqual(['diastolic', 'pulse', 'systolic'])
  })
})
