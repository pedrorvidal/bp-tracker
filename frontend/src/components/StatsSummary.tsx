import { formatAverage } from '../lib/format'
import type { ReadingStats } from '../types'

interface StatsSummaryProps {
  days: number
  stats: ReadingStats | undefined
  isLoading: boolean
  isError: boolean
}

/** Averages for the selected period, from GET /stats. */
export default function StatsSummary({
  days,
  stats,
  isLoading,
  isError,
}: StatsSummaryProps) {
  return (
    <section
      aria-labelledby="stats-heading"
      className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"
    >
      <h3 id="stats-heading" className="text-base font-semibold sm:text-lg">
        Averages, last {days} days
      </h3>

      {isLoading && (
        <p role="status" className="mt-2 text-slate-700">
          Loading averages…
        </p>
      )}
      {isError && (
        <p role="alert" className="mt-2 text-red-800">
          Could not load the averages.
        </p>
      )}
      {stats && (
        <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="text-sm text-slate-600">Blood pressure</dt>
            <dd className="text-xl font-semibold text-slate-900 sm:text-2xl">
              {formatAverage(stats.systolic_average)}/
              {formatAverage(stats.diastolic_average)}
              <span className="block text-sm font-normal text-slate-600">
                mmHg
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Pulse</dt>
            <dd className="text-xl font-semibold text-slate-900 sm:text-2xl">
              {formatAverage(stats.pulse_average)}
              <span className="block text-sm font-normal text-slate-600">
                bpm
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Readings</dt>
            <dd className="text-xl font-semibold text-slate-900 sm:text-2xl">
              {stats.count}
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}
