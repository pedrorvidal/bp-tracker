import type { TooltipContentProps, TooltipValueType } from 'recharts'
import type { ChartPoint } from '../lib/aggregate'
import { CATEGORY_LABELS, classify } from '../lib/bpCategory'
import { formatDateTime } from '../lib/format'
import { SERIES } from './chartSeries'

/**
 * Tooltip for a chart point: when it was taken (or which day it averages),
 * both pressures, pulse and the reference category.
 */
export default function ChartTooltip({
  active,
  payload,
}: TooltipContentProps<TooltipValueType, string | number>) {
  const point = payload?.[0]?.payload as ChartPoint | undefined
  // Placeholder points of an empty chart carry no values.
  if (!active || !point || typeof point.systolic !== 'number') {
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
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-md">
      <p className="font-semibold text-slate-900">{when}</p>
      <ul className="mt-1 space-y-0.5">
        {(['systolic', 'diastolic'] as const).map((key) => (
          <li key={key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-3"
              style={{ backgroundColor: SERIES[key].color }}
            />
            {SERIES[key].name} {point[key]} mmHg
          </li>
        ))}
        {point.pulse !== null && (
          <li className="pl-5">Pulse {point.pulse} bpm</li>
        )}
      </ul>
      <p className="mt-1 text-slate-600">
        {CATEGORY_LABELS[classify(point.systolic, point.diastolic)]} (reference)
      </p>
    </div>
  )
}
