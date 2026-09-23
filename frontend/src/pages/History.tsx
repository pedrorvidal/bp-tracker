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
    <section aria-labelledby="history-heading" className="space-y-5">
      <h2 id="history-heading" className="text-xl font-semibold sm:text-2xl">
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

      <SummaryCard range={range} />

      {readings.isPending && (
        <p role="status" className="text-slate-700">
          Loading readings…
        </p>
      )}

      {readings.isError && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800"
        >
          <p>Could not load your readings.</p>
          <button
            type="button"
            onClick={() => void readings.refetch()}
            className="mt-2 min-h-11 rounded-md border border-red-700 px-3 text-sm font-medium hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            Try again
          </button>
        </div>
      )}

      {readings.data && (
        <ReadingsChart readings={readings.data} range={range} />
      )}

      <section aria-labelledby="list-heading" className="space-y-3">
        <h3 id="list-heading" className="text-base font-semibold sm:text-lg">
          Readings
        </h3>

        <div role="status" className="empty:hidden">
          {notice && (
            <p className="rounded-md border border-green-700 bg-green-50 px-4 py-3 text-green-900">
              {notice}
            </p>
          )}
        </div>
        {deleteError && (
          <p
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800"
          >
            {deleteError}
          </p>
        )}

        {readings.data && readings.data.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-700">
            No readings for {describeRange(range)}.{' '}
            <Link
              to="/new"
              className="font-medium text-blue-800 underline hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
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
