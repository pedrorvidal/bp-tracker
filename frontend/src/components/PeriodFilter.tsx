import { PERIOD_OPTIONS, type PeriodDays } from '../lib/period'

interface PeriodFilterProps {
  value: PeriodDays
  onChange: (days: PeriodDays) => void
}

/** Quick period filter: a group of toggle buttons (one pressed at a time). */
export default function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  return (
    <div
      role="group"
      aria-label="Period"
      className="inline-flex rounded-lg border border-slate-300 bg-white p-1"
    >
      {PERIOD_OPTIONS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          onClick={() => onChange(days)}
          className="min-h-11 rounded-md px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 aria-pressed:bg-blue-700 aria-pressed:text-white aria-pressed:hover:bg-blue-700"
        >
          {days} days
        </button>
      ))}
    </div>
  )
}
