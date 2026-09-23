import { useAllReadings, useStats } from '../hooks/useReadings'
import { categoryCounts } from '../lib/bpCategory'
import {
  describeRange,
  isLifetime,
  previousRange,
  rangeLengthDays,
  rangeToParams,
  type DateRange,
} from '../lib/dateRange'
import { formatAverage } from '../lib/format'
import type { ReadingStats } from '../types'
import CategoryDistribution from './CategoryDistribution'
import StatCard, { type Change } from './StatCard'

/** Fewer readings than this in the previous period: no comparison (too noisy). */
export const MIN_READINGS_TO_COMPARE = 3

interface SummaryCardProps {
  range: DateRange
}

type Measure = 'systolic' | 'diastolic' | 'pulse'

/**
 * Headline numbers of the selected period as four mini-cards (averages of
 * systolic, diastolic and pulse, and the reading count with the category
 * distribution), each average compared with the previous period of the same
 * length.
 */
export default function SummaryCard({ range }: SummaryCardProps) {
  const params = rangeToParams(range)
  const current = useStats(params)
  // Same query as the history list: served from the cache, no extra request.
  const readings = useAllReadings(params)
  const before = previousRange(range)
  const previous = useStats(before ? rangeToParams(before) : {}, {
    enabled: before !== null,
  })

  const days = rangeLengthDays(range)
  const previousLabel = `previous ${days} ${days === 1 ? 'day' : 'days'}`
  const comparable =
    before !== null &&
    previous.data !== undefined &&
    previous.data.count >= MIN_READINGS_TO_COMPARE
      ? previous.data
      : null

  function change(
    stats: ReadingStats,
    measure: Measure,
    unit: string,
  ): Change | null {
    const now = stats[`${measure}_average`]
    const then = comparable?.[`${measure}_average`] ?? null
    if (now === null || then === null) {
      return null
    }
    return { delta: Math.round((now - then) * 10) / 10, unit, previousLabel }
  }

  function minMax(stats: ReadingStats, measure: Measure): string {
    return `Min ${stats[`${measure}_min`] ?? '—'} · Max ${stats[`${measure}_max`] ?? '—'}`
  }

  return (
    <section aria-labelledby="summary-heading" className="space-y-4">
      <h3
        id="summary-heading"
        className="text-xl font-semibold text-slate-900 dark:text-slate-100"
      >
        Summary, {describeRange(range)}
      </h3>

      {current.isPending && (
        <p role="status" className="text-slate-500 dark:text-slate-400">
          Loading summary…
        </p>
      )}
      {current.isError && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          Could not load the summary.
        </p>
      )}

      {current.data && (
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Avg systolic"
            value={formatAverage(current.data.systolic_average)}
            unit="mmHg"
            detail={minMax(current.data, 'systolic')}
            change={change(current.data, 'systolic', 'mmHg')}
            tone="lowerIsBetter"
          />
          <StatCard
            label="Avg diastolic"
            value={formatAverage(current.data.diastolic_average)}
            unit="mmHg"
            detail={minMax(current.data, 'diastolic')}
            change={change(current.data, 'diastolic', 'mmHg')}
            tone="lowerIsBetter"
          />
          <StatCard
            label="Avg pulse"
            value={formatAverage(current.data.pulse_average)}
            unit="bpm"
            detail={minMax(current.data, 'pulse')}
            change={change(current.data, 'pulse', 'bpm')}
          />
          <StatCard
            label="Readings"
            value={String(current.data.count)}
            detail={
              current.data.count === 1
                ? 'reading in the period'
                : 'readings in the period'
            }
          >
            {readings.data && (
              <CategoryDistribution counts={categoryCounts(readings.data)} />
            )}
          </StatCard>
        </dl>
      )}

      {current.data && !isLifetime(range) && comparable === null && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Not enough readings in the {previousLabel} to compare.
        </p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Categories follow the 2017 ACC/AHA guideline (a reading takes the more
        severe of its systolic and diastolic categories). For reference only;
        not a diagnosis.
      </p>
    </section>
  )
}
