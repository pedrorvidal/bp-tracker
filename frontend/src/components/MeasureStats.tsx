import { formatAverage } from '../lib/format'
import type { ReadingStats } from '../types'

export interface MeasureInfo {
  key: 'systolic' | 'diastolic' | 'pulse'
  label: string
  unit: string
}

interface MeasureStatsProps {
  stats: ReadingStats
  /** Stats of the previous period, or null to omit the comparison. */
  previous: ReadingStats | null
  measure: MeasureInfo
  previousLabel: string
}

function comparison(
  current: number | null,
  previous: number | null,
  unit: string,
  previousLabel: string,
): { arrow: string; text: string } | null {
  if (current === null || previous === null) {
    return null
  }
  const delta = Math.round((current - previous) * 10) / 10
  if (delta === 0) {
    return { arrow: '=', text: `Same as the ${previousLabel}` }
  }
  const amount = Math.abs(delta).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })
  return delta > 0
    ? { arrow: '↑', text: `${amount} ${unit} higher than the ${previousLabel}` }
    : { arrow: '↓', text: `${amount} ${unit} lower than the ${previousLabel}` }
}

export default function MeasureStats({
  stats,
  previous,
  measure,
  previousLabel,
}: MeasureStatsProps) {
  const average = stats[`${measure.key}_average`]
  const min = stats[`${measure.key}_min`]
  const max = stats[`${measure.key}_max`]
  const change = previous
    ? comparison(
        average,
        previous[`${measure.key}_average`],
        measure.unit,
        previousLabel,
      )
    : null

  return (
    <div className="rounded-md bg-slate-50 p-3">
      <dt className="text-sm font-medium text-slate-700">{measure.label}</dt>
      <dd className="mt-1">
        <span className="text-2xl font-semibold text-slate-900">
          {formatAverage(average)}
        </span>{' '}
        <span className="text-sm text-slate-600">{measure.unit} average</span>
        <span className="mt-0.5 block text-sm text-slate-700">
          Min {min ?? '—'} · Max {max ?? '—'}
        </span>
        {change && (
          <span className="mt-0.5 block text-sm text-slate-700">
            <span aria-hidden="true">{change.arrow} </span>
            {change.text}
          </span>
        )}
      </dd>
    </div>
  )
}
