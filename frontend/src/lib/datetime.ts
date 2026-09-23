/**
 * Conversions between <input type="datetime-local"> values ("YYYY-MM-DDTHH:mm",
 * local time, no offset) and the API's ISO 8601 date-times with an offset.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Formats a Date as a datetime-local input value, in the user's local time. */
export function toDateTimeLocalValue(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Parses a datetime-local value as local time.
 *
 * Returns null for malformed or impossible values (e.g. February 30th),
 * which `new Date()` would otherwise silently roll over.
 */
export function parseDateTimeLocal(value: string): Date | null {
  const match = DATETIME_LOCAL.exec(value)

  if (!match) {
    return null
  }

  const [year, month, day, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => (part === undefined ? 0 : Number(part))) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const date = new Date(year, month - 1, day, hours, minutes, seconds)

  const roundTrips =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hours &&
    date.getMinutes() === minutes

  return roundTrips ? date : null
}

/**
 * Formats a Date as ISO 8601 in local time with the local UTC offset,
 * e.g. "2026-09-23T14:30:00-03:00", so the reading keeps the wall-clock time
 * the user saw.
 */
export function toIsoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)

  return (
    `${toDateTimeLocalValue(date)}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  )
}
