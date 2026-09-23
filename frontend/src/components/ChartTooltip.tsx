import type { TooltipContentProps, TooltipValueType } from 'recharts'
import type { ChartPoint } from '../lib/aggregate'
import { classify } from '../lib/bpCategory'
import { formatDateTime } from '../lib/format'
import CategoryBadge from './CategoryBadge'

/**
 * Tooltip for a chart point: when it was taken (or which day it averages),
 * the reading as systolic/diastolic, pulse, and its ACC/AHA category.
 */
export default function ChartTooltip({
  active,
  payload,
}: TooltipContentProps<TooltipValueType, string | number>) {
  const point = payload?.[0]?.payload as ChartPoint | undefined
  if (!active || !point) {
    return null
  }

  const day = new Date(point.time).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  })
  const when = !point.aggregated
    ? formatDateTime(new Date(point.time).toISOString())
    : point.count === 1
      ? `${day} · 1 reading`
      : `${day} · average of ${point.count} readings`

  return (
    <div className="min-w-44 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <p className="text-slate-500 dark:text-slate-400">{when}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums dark:text-slate-100">
        {point.systolic}/{point.diastolic}{' '}
        <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
          mmHg
        </span>
      </p>
      {point.pulse !== null && (
        <p className="text-slate-700 tabular-nums dark:text-slate-300">
          Pulse {point.pulse} bpm
        </p>
      )}
      <p className="mt-2">
        <CategoryBadge category={classify(point.systolic, point.diastolic)} />
      </p>
    </div>
  )
}
