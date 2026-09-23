import { toIsoWithOffset } from './datetime'

/** Quick period filters offered by the history page, in days. */
export const PERIOD_OPTIONS = [7, 30] as const

export type PeriodDays = (typeof PERIOD_OPTIONS)[number]

export interface Period {
  /** Inclusive start: local midnight, (days - 1) days ago. */
  start: Date
  /** Inclusive end: the last second of today, local time. */
  end: Date
}

/**
 * "Last N days" as whole local days, today included.
 *
 * Whole days (rather than "now minus N×24h") keep the bounds stable for the
 * whole day, so query keys don't change on every render, and readings added
 * later today still fall inside the period.
 */
export function lastDays(days: number, now: Date = new Date()): Period {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (days - 1),
  )
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
  )
  return { start, end }
}

/** The period as API query params (ISO 8601 with the local offset). */
export function periodParams(period: Period): {
  period_start: string
  period_end: string
} {
  return {
    period_start: toIsoWithOffset(period.start),
    period_end: toIsoWithOffset(period.end),
  }
}
