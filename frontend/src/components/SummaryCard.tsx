import { useStats } from '../hooks/useReadings'
import {
  describeRange,
  isLifetime,
  previousRange,
  rangeLengthDays,
  rangeToParams,
  type DateRange,
} from '../lib/dateRange'
import MeasureStats, { type MeasureInfo } from './MeasureStats'

/** Fewer readings than this in the previous period: no comparison (too noisy). */
export const MIN_READINGS_TO_COMPARE = 3

const MEASURES: MeasureInfo[] = [
  { key: 'systolic', label: 'Systolic', unit: 'mmHg' },
  { key: 'diastolic', label: 'Diastolic', unit: 'mmHg' },
  { key: 'pulse', label: 'Pulse', unit: 'bpm' },
]

interface SummaryCardProps {
  range: DateRange
}

/**
 * Average, minimum and maximum of each measure for the selected period, and
 * how the averages changed against the previous period of the same length.
 */
export default function SummaryCard({ range }: SummaryCardProps) {
  const current = useStats(rangeToParams(range))
  const before = previousRange(range)
  const previous = useStats(before ? rangeToParams(before) : {}, {
    enabled: before !== null,
  })

  const days = rangeLengthDays(range)
  const previousLabel = `previous ${days} ${days === 1 ? 'day' : 'days'}`
  const canCompare =
    before !== null &&
    previous.data !== undefined &&
    previous.data.count >= MIN_READINGS_TO_COMPARE

  return (
    <section
      aria-labelledby="summary-heading"
      className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 id="summary-heading" className="text-base font-semibold sm:text-lg">
          Summary, {describeRange(range)}
        </h3>
        {current.data && (
          <p className="text-sm text-slate-600">
            {current.data.count}{' '}
            {current.data.count === 1 ? 'reading' : 'readings'}
          </p>
        )}
      </div>

      {current.isPending && (
        <p role="status" className="mt-2 text-slate-700">
          Loading summary…
        </p>
      )}
      {current.isError && (
        <p role="alert" className="mt-2 text-red-800">
          Could not load the summary.
        </p>
      )}
      {current.data && (
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {MEASURES.map((measure) => (
            <MeasureStats
              key={measure.key}
              stats={current.data}
              previous={canCompare ? (previous.data ?? null) : null}
              measure={measure}
              previousLabel={previousLabel}
            />
          ))}
        </dl>
      )}
      {current.data && !isLifetime(range) && !canCompare && (
        <p className="mt-2 text-sm text-slate-600">
          Not enough readings in the {previousLabel} to compare.
        </p>
      )}
    </section>
  )
}
