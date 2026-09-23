import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PeriodFilter from '../components/PeriodFilter'
import ReadingList from '../components/ReadingList'
import ReadingsChart from '../components/ReadingsChart'
import StatsSummary from '../components/StatsSummary'
import {
  useAllReadings,
  useDeleteReading,
  useReadingStats,
} from '../hooks/useReadings'
import { formatDateTime } from '../lib/format'
import { lastDays, periodParams, type PeriodDays } from '../lib/period'
import type { Reading } from '../types'

export const DEFAULT_PERIOD: PeriodDays = 30

export default function History() {
  const [days, setDays] = useState<PeriodDays>(DEFAULT_PERIOD)
  // Whole local days: stable for the whole day, so the query key doesn't
  // change on every render.
  const period = useMemo(() => lastDays(days), [days])
  const params = useMemo(() => periodParams(period), [period])

  const readings = useAllReadings(params)
  const stats = useReadingStats(params)
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="history-heading" className="text-xl font-semibold sm:text-2xl">
          History
        </h2>
        <PeriodFilter
          value={days}
          onChange={(value) => {
            setNotice(null)
            setDeleteError(null)
            setDays(value)
          }}
        />
      </div>

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

      <StatsSummary
        days={days}
        stats={stats.data}
        isLoading={stats.isPending}
        isError={stats.isError}
      />

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

      {readings.data && readings.data.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-700">
          No readings in the last {days} days.{' '}
          <Link
            to="/new"
            className="font-medium text-blue-800 underline hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Record a reading
          </Link>
        </p>
      )}

      {readings.data && readings.data.length > 0 && (
        <>
          <ReadingsChart readings={readings.data} period={period} days={days} />
          <section aria-labelledby="list-heading" className="space-y-3">
            <h3
              id="list-heading"
              className="text-base font-semibold sm:text-lg"
            >
              Readings
            </h3>
            <ReadingList
              readings={readings.data}
              onDelete={(reading) => void handleDelete(reading)}
              deletingId={
                deleteReading.isPending
                  ? (deleteReading.variables ?? null)
                  : null
              }
            />
          </section>
        </>
      )}
    </section>
  )
}
