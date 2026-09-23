import { toIsoWithOffset } from './datetime'

/**
 * A period of whole local days, both ends inclusive, as "YYYY-MM-DD" (the
 * format of <input type="date">). { start: null, end: null } is "lifetime":
 * every reading.
 */
export interface DateRange {
  start: string | null
  end: string | null
}

export const LIFETIME: DateRange = { start: null, end: null }

export type PresetId = '7' | '10' | '30' | '90' | 'lifetime'

export const PRESETS: ReadonlyArray<{
  id: PresetId
  label: string
  days: number | null
}> = [
  { id: '7', label: '7 days', days: 7 },
  { id: '10', label: '10 days', days: 10 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: 'lifetime', label: 'Lifetime', days: null },
]

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Formats a Date as "YYYY-MM-DD" in local time. */
export function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Parses "YYYY-MM-DD" as local midnight; null for malformed or impossible dates. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return null
  }
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** "Last N days": whole local days, today included. */
export function lastDays(days: number, today: Date = new Date()): DateRange {
  return {
    start: toDateInputValue(addDays(today, -(days - 1))),
    end: toDateInputValue(today),
  }
}

/** The range a preset stands for, as of `today`. */
export function presetRange(id: PresetId, today: Date = new Date()): DateRange {
  const preset = PRESETS.find((p) => p.id === id)
  return preset?.days ? lastDays(preset.days, today) : LIFETIME
}

/** The preset a range corresponds to (as of `today`), if any. */
export function matchPreset(
  range: DateRange,
  today: Date = new Date(),
): PresetId | null {
  const found = PRESETS.find((preset) => {
    const candidate = presetRange(preset.id, today)
    return candidate.start === range.start && candidate.end === range.end
  })
  return found?.id ?? null
}

export function isLifetime(range: DateRange): boolean {
  return range.start === null && range.end === null
}

/** Number of days in a bounded range (inclusive); null for lifetime. */
export function rangeLengthDays(range: DateRange): number | null {
  const start = range.start ? parseDateInput(range.start) : null
  const end = range.end ? parseDateInput(range.end) : null
  if (!start || !end) {
    return null
  }
  // Round: DST changes make some days 23 or 25 hours long.
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
}

/**
 * The period of the same length right before `range` (e.g. the 30 days
 * before "the last 30 days"); null for lifetime, which has nothing before it.
 */
export function previousRange(range: DateRange): DateRange | null {
  const length = rangeLengthDays(range)
  const start = range.start ? parseDateInput(range.start) : null
  if (length === null || !start) {
    return null
  }
  return {
    start: toDateInputValue(addDays(start, -length)),
    end: toDateInputValue(addDays(start, -1)),
  }
}

/**
 * API query params: from local midnight of the first day to 23:59:59 of the
 * last one, with the local offset. Lifetime sends no params.
 */
export function rangeToParams(range: DateRange): {
  period_start?: string
  period_end?: string
} {
  const params: { period_start?: string; period_end?: string } = {}
  const start = range.start ? parseDateInput(range.start) : null
  const end = range.end ? parseDateInput(range.end) : null
  if (start) {
    params.period_start = toIsoWithOffset(start)
  }
  if (end) {
    params.period_end = toIsoWithOffset(
      new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59),
    )
  }
  return params
}

function shortDate(value: string): string {
  const date = parseDateInput(value)
  return date
    ? date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : value
}

/** Human description, e.g. "last 30 days", "all time", "Sep 1, 2026 – Sep 15, 2026". */
export function describeRange(
  range: DateRange,
  today: Date = new Date(),
): string {
  if (isLifetime(range)) {
    return 'all time'
  }
  const preset = matchPreset(range, today)
  if (preset && preset !== 'lifetime') {
    return `last ${preset} days`
  }
  return `${shortDate(range.start ?? '')} – ${shortDate(range.end ?? '')}`
}
