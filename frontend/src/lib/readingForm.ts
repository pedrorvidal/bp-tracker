import type { ReadingInput } from '../types'
import { parseDateTimeLocal, toIsoWithOffset } from './datetime'

/** Raw values of the reading form, as typed. */
export interface ReadingFormValues {
  reading_datetime: string
  systolic: string
  diastolic: string
  pulse: string
  weight: string
  notes: string
}

export type ReadingFormField = keyof ReadingFormValues

export type ReadingFormErrors = Partial<Record<ReadingFormField, string>>

/** Limits shared with the backend (BP_Tracker_CPT). */
export const LIMITS = {
  systolic: { min: 60, max: 250 },
  diastolic: { min: 40, max: 150 },
  pulse: { min: 30, max: 220 },
} as const

/** Field order, used to focus the first invalid field. */
export const FIELD_ORDER: ReadingFormField[] = [
  'reading_datetime',
  'systolic',
  'diastolic',
  'pulse',
  'weight',
  'notes',
]

function parseInteger(value: string): number | null {
  const trimmed = value.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

function parseDecimal(value: string): number | null {
  // Accept a comma as the decimal separator too (e.g. "72,5").
  const trimmed = value.trim().replace(',', '.')
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null
}

function checkRange(
  label: string,
  value: string,
  limits: { min: number; max: number },
  required: boolean,
): { error?: string; value?: number } {
  if (value.trim() === '') {
    return required ? { error: `Enter the ${label} value.` } : {}
  }

  const parsed = parseInteger(value)

  if (parsed === null) {
    return { error: `${capitalize(label)} must be a whole number.` }
  }
  if (parsed < limits.min || parsed > limits.max) {
    return {
      error: `${capitalize(label)} must be between ${limits.min} and ${limits.max}.`,
    }
  }
  return { value: parsed }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Validates the form. Returns either field errors, or the API payload.
 *
 * Optional fields left empty are omitted from the payload.
 */
export function validateReading(
  values: ReadingFormValues,
): { errors: ReadingFormErrors } | { input: ReadingInput } {
  const errors: ReadingFormErrors = {}

  const date = parseDateTimeLocal(values.reading_datetime)
  if (values.reading_datetime.trim() === '') {
    errors.reading_datetime = 'Enter the date and time of the reading.'
  } else if (date === null) {
    errors.reading_datetime = 'Enter a valid date and time.'
  }

  const systolic = checkRange(
    'systolic',
    values.systolic,
    LIMITS.systolic,
    true,
  )
  const diastolic = checkRange(
    'diastolic',
    values.diastolic,
    LIMITS.diastolic,
    true,
  )
  const pulse = checkRange('pulse', values.pulse, LIMITS.pulse, false)

  if (systolic.error) errors.systolic = systolic.error
  if (diastolic.error) errors.diastolic = diastolic.error
  if (pulse.error) errors.pulse = pulse.error

  if (
    systolic.value !== undefined &&
    diastolic.value !== undefined &&
    systolic.value <= diastolic.value
  ) {
    // Physiologically impossible; almost always the two values were swapped.
    errors.systolic = 'Systolic must be higher than diastolic.'
  }

  let weight: number | undefined
  if (values.weight.trim() !== '') {
    const parsed = parseDecimal(values.weight)
    if (parsed === null || parsed <= 0) {
      errors.weight = 'Weight must be a positive number, e.g. 72.5.'
    } else {
      weight = parsed
    }
  }

  if (
    Object.keys(errors).length > 0 ||
    date === null ||
    systolic.value === undefined ||
    diastolic.value === undefined
  ) {
    return { errors }
  }

  const input: ReadingInput = {
    reading_datetime: toIsoWithOffset(date),
    systolic: systolic.value,
    diastolic: diastolic.value,
  }
  if (pulse.value !== undefined) input.pulse = pulse.value
  if (weight !== undefined) input.weight = weight
  if (values.notes.trim() !== '') input.notes = values.notes.trim()

  return { input }
}
