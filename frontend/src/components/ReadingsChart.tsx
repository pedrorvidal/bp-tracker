import { useId, useState } from 'react'
import { AGGREGATE_THRESHOLD, chartPoints } from '../lib/aggregate'
import { DIASTOLIC_ZONES, SYSTOLIC_ZONES } from '../lib/bpCategory'
import { describeRange, parseDateInput, type DateRange } from '../lib/dateRange'
import type { Reading } from '../types'
import BpPanel from './BpPanel'
import ChartLegend from './ChartLegend'

interface ReadingsChartProps {
  readings: Reading[]
  range: DateRange
}

const WEEK = 7 * 24 * 60 * 60 * 1000

/** X range for an empty chart: the selected period, or the last week. */
function emptyDomain(range: DateRange): [number, number] {
  const start = range.start ? parseDateInput(range.start) : null
  const end = range.end ? parseDateInput(range.end) : null
  const now = Date.now()
  return [start?.getTime() ?? now - WEEK, (end?.getTime() ?? now) + WEEK / 7]
}

const linkButtonClass =
  'font-medium text-blue-800 underline hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'

/**
 * Systolic and diastolic over time, in two panels sharing the time axis, each
 * on its own clinical reference bands (the categories use different
 * thresholds per measure, so one set of bands can't be right for both
 * lines). A Brush below zooms both panels. Above AGGREGATE_THRESHOLD
 * readings the chart shows daily averages unless the user asks otherwise.
 */
export default function ReadingsChart({ readings, range }: ReadingsChartProps) {
  const captionId = useId()
  const [showEveryReading, setShowEveryReading] = useState(false)
  const { points, aggregated } = chartPoints(readings, showEveryReading)
  const many = readings.length > AGGREGATE_THRESHOLD
  const domain = emptyDomain(range)
  // Remount the panels when the plotted data changes, resetting the Brush.
  const dataKey = `${points.length}-${points[0]?.time ?? 0}-${aggregated}`

  return (
    <figure
      aria-labelledby={captionId}
      className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"
    >
      <figcaption
        id={captionId}
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        Blood pressure, {describeRange(range)}
      </figcaption>

      <p aria-live="polite" className="mt-1 text-sm text-slate-600">
        {readings.length === 0 && 'No readings in this period.'}
        {readings.length > 0 &&
          !many &&
          `Showing ${readings.length} ${readings.length === 1 ? 'reading' : 'readings'}.`}
        {aggregated && (
          <>
            Showing daily averages ({points.length} days, {readings.length}{' '}
            readings).{' '}
            <button
              type="button"
              onClick={() => setShowEveryReading(true)}
              className={linkButtonClass}
            >
              Show every reading
            </button>
          </>
        )}
        {many && !aggregated && (
          <>
            Showing every reading ({readings.length}).{' '}
            <button
              type="button"
              onClick={() => setShowEveryReading(false)}
              className={linkButtonClass}
            >
              Show daily averages
            </button>
          </>
        )}
      </p>

      <div key={dataKey} className="mt-2">
        <p className="text-sm font-medium text-slate-800">Systolic</p>
        <BpPanel
          measure="systolic"
          points={points}
          zones={SYSTOLIC_ZONES}
          baseDomain={[100, 160]}
          emptyDomain={domain}
          showTooltip
          isBottom={false}
          className="h-40 md:h-52"
        />
        <p className="mt-2 text-sm font-medium text-slate-800">Diastolic</p>
        <BpPanel
          measure="diastolic"
          points={points}
          zones={DIASTOLIC_ZONES}
          baseDomain={[60, 100]}
          emptyDomain={domain}
          showTooltip={false}
          isBottom
          className="h-52 md:h-64"
        />
      </div>

      <ChartLegend />
    </figure>
  )
}
