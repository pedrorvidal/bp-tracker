import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PeriodSelector from '../components/PeriodSelector'
import ReadingList from '../components/ReadingList'
import ReadingsChart from '../components/ReadingsChart'
import SummaryCard from '../components/SummaryCard'
import { useAllReadings, useDeleteReading } from '../hooks/useReadings'
import {
  describeRange,
  lastDays,
  rangeToParams,
  type DateRange,
} from '../lib/dateRange'
import { formatDateTime } from '../lib/format'
import type { Reading } from '../types'

export const DEFAULT_DAYS = 30

/**
 * History dashboard, mobile-first: everything stacks in one column; from lg
 * up the title and period selector share a row and the summary becomes a
 * row of four cards. The page uses the full max-w-7xl container.
 */
export default function History() {
  const [range, setRange] = useState<DateRange>(() => lastDays(DEFAULT_DAYS))
  // Part of the query keys: changing the period refetches readings and stats.
  const params = useMemo(() => rangeToParams(range), [range])

  const readings = useAllReadings(params)
  const deleteReading = useDeleteReading()
  const [notice, setNotice] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete(reading: Reading) {
    setNotice(null)
    setDeleteError(null)

    const confirmed = window.confirm(
      `Delete the reading of ${formatDateTime(reading.reading_datetime)} (${reading.systolic}/${reading.diastolic} mmHg)? This can't be undone.`,
    )
    if (!confirmed) {
      return
    }

    try {
      await deleteReading.mutateAsync(reading.id)
      setNotice('Reading deleted.')
    } catch {
      setDeleteError('Could not delete the reading. Try again.')
    }
  }

  return (
    <section aria-labelledby="history-heading" className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h2
          id="history-heading"
          className="text-2xl font-semibold text-slate-900 lg:text-3xl dark:text-slate-100"
        >
          History
        </h2>
        <PeriodSelector
          value={range}
          onChange={(next) => {
            setNotice(null)
            setDeleteError(null)
            setRange(next)
          }}
        />
      </div>

      <SummaryCard range={range} />

      {readings.isPending && (
        <p role="status" className="text-slate-500 dark:text-slate-400">
          Loading readings…
        </p>
      )}

      {readings.isError && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          <p>Could not load your readings.</p>
          <button
            type="button"
            onClick={() => void readings.refetch()}
            className="mt-3 min-h-11 rounded-lg border border-red-300 px-4 text-sm font-medium transition-colors duration-200 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:border-red-800 dark:hover:bg-red-900/40"
          >
            Try again
          </button>
        </div>
      )}

      {readings.data && (
        <ReadingsChart readings={readings.data} range={range} />
      )}

      <section aria-labelledby="list-heading" className="space-y-4">
        <h3
          id="list-heading"
          className="text-xl font-semibold text-slate-900 dark:text-slate-100"
        >
          Readings
        </h3>

        <div role="status" className="empty:hidden">
          {notice && (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              {notice}
            </p>
          )}
        </div>
        {deleteError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {deleteError}
          </p>
        )}

        {readings.data && readings.data.length === 0 && (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            No readings for {describeRange(range)}.{' '}
            <Link
              to="/new"
              className="font-medium text-blue-700 underline transition-colors duration-200 hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Record a reading
            </Link>
          </p>
        )}

        {readings.data && readings.data.length > 0 && (
          <ReadingList
            readings={readings.data}
            onDelete={(reading) => void handleDelete(reading)}
            deletingId={
              deleteReading.isPending ? (deleteReading.variables ?? null) : null
            }
          />
        )}
      </section>
    </section>
  )
}
