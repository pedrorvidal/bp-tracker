import { useId, useState } from 'react'
import {
  PRESETS,
  lastDays,
  matchPreset,
  parseDateInput,
  presetRange,
  toDateInputValue,
  type DateRange,
} from '../lib/dateRange'

interface PeriodSelectorProps {
  /** Selected period (state lives in the parent). */
  value: DateRange
  /** Emits { start, end } as "YYYY-MM-DD"; { null, null } means lifetime. */
  onChange: (range: DateRange) => void
}

const buttonClass =
  'min-h-11 rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 aria-pressed:bg-blue-700 aria-pressed:text-white aria-pressed:hover:bg-blue-700'

const inputClass =
  'block min-h-11 w-full rounded-md border border-slate-400 bg-white px-3 text-base text-slate-900 focus:border-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 aria-invalid:border-red-700'

/**
 * Period presets (7/10/30/90 days, lifetime) plus a custom range made of two
 * native date inputs.
 */
export default function PeriodSelector({
  value,
  onChange,
}: PeriodSelectorProps) {
  const today = new Date()
  const todayValue = toDateInputValue(today)
  const matched = matchPreset(value, today)
  const [customOpen, setCustomOpen] = useState(matched === null)
  const [from, setFrom] = useState(
    value.start ?? lastDays(30, today).start ?? '',
  )
  const [to, setTo] = useState(value.end ?? todayValue)
  const errorId = useId()

  const fromDate = parseDateInput(from)
  const toDate = parseDateInput(to)
  const error =
    fromDate && toDate && fromDate > toDate
      ? 'The start date must be on or before the end date.'
      : null

  function changeCustom(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    const start = parseDateInput(nextFrom)
    const end = parseDateInput(nextTo)
    if (start && end && start <= end) {
      onChange({ start: nextFrom, end: nextTo })
    }
  }

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Period"
        className="grid grid-cols-3 gap-1 rounded-lg border border-slate-300 bg-white p-1 sm:inline-flex sm:flex-wrap"
      >
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={!customOpen && matched === preset.id}
            onClick={() => {
              setCustomOpen(false)
              onChange(presetRange(preset.id, new Date()))
            }}
            className={buttonClass}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={customOpen}
          aria-expanded={customOpen}
          aria-controls={`${errorId}-custom`}
          onClick={() => {
            setCustomOpen(true)
            // Apply the dates already in the fields.
            changeCustom(from, to)
          }}
          className={buttonClass}
        >
          Custom
        </button>
      </div>

      {customOpen && (
        <fieldset
          id={`${errorId}-custom`}
          className="grid grid-cols-2 gap-3 sm:max-w-md"
        >
          <legend className="sr-only">Custom period</legend>
          <div>
            <label
              htmlFor={`${errorId}-from`}
              className="block text-sm font-medium text-slate-800"
            >
              From
            </label>
            <input
              id={`${errorId}-from`}
              type="date"
              value={from}
              max={todayValue}
              onChange={(event) => changeCustom(event.target.value, to)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor={`${errorId}-to`}
              className="block text-sm font-medium text-slate-800"
            >
              To
            </label>
            <input
              id={`${errorId}-to`}
              type="date"
              value={to}
              max={todayValue}
              onChange={(event) => changeCustom(from, event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={inputClass}
            />
          </div>
          {error && (
            <p
              id={errorId}
              role="alert"
              className="col-span-2 text-sm font-medium text-red-800"
            >
              {error}
            </p>
          )}
        </fieldset>
      )}
    </div>
  )
}
