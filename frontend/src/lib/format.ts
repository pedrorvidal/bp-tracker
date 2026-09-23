/** Date and time of a reading, in the user's locale, e.g. "Sep 23, 2026, 7:45 AM". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** An average from /stats (one decimal at most), or an em dash when there is none. */
export function formatAverage(value: number | null): string {
  return value === null
    ? '—'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}
