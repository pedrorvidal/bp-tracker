import { useId, useState } from 'react'
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePrefersDark } from '../hooks/usePrefersDark'
import {
  AGGREGATE_THRESHOLD,
  chartPoints,
  type ChartPoint,
} from '../lib/aggregate'
import {
  NORMAL_DIASTOLIC_BELOW,
  NORMAL_SYSTOLIC_BELOW,
} from '../lib/bpCategory'
import { describeRange, type DateRange } from '../lib/dateRange'
import type { Reading } from '../types'
import ChartTooltip from './ChartTooltip'
import { DARK, LIGHT, SERIES_NAMES } from './chartSeries'
import LegendChips from './LegendChips'

/**
 * Above this many points, dots are left out (they crowd each other on a
 * phone); the lines show the trend and hovering still highlights a point.
 */
export const MAX_POINTS_WITH_DOTS = 31

interface ReadingsChartProps {
  readings: Reading[]
  range: DateRange
}

/** A point with its position on the categorical X axis. */
type Slot = ChartPoint & { slot: number }

function shortDay(time: number): string {
  return new Date(time).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

/** Round Y bounds covering the data and both normal limits, with headroom. */
function yAxis(points: ChartPoint[]) {
  const values = points.flatMap((p) => [p.systolic, p.diastolic])
  const min = Math.min(NORMAL_DIASTOLIC_BELOW - 10, ...values.map((v) => v - 5))
  const max = Math.max(NORMAL_SYSTOLIC_BELOW + 10, ...values.map((v) => v + 5))
  const step = max - min > 80 ? 20 : 10
  const low = Math.floor(min / step) * step
  const high = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let tick = low; tick <= high; tick += step) ticks.push(tick)
  return { low, high, ticks }
}

const linkButtonClass =
  'font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 transition-colors duration-200 hover:text-blue-900 hover:decoration-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:text-blue-300'

/**
 * Systolic and diastolic in one chart on a shared mmHg axis, one position per
 * reading (categorical X). Dashed lines mark the upper limits of "normal";
 * each point's category is in the tooltip. A Brush zooms and pans. Above
 * AGGREGATE_THRESHOLD readings the chart plots daily averages unless the
 * user asks for every reading.
 */
export default function ReadingsChart({ readings, range }: ReadingsChartProps) {
  const captionId = useId()
  const theme = usePrefersDark() ? DARK : LIGHT
  // The limit labels sit in the right margin, outside the plot, so they never
  // cover data: full text on wide screens, just the value on phones.
  const wide = useMediaQuery('(min-width: 1024px)')
  const limitLabel = (name: string, value: number) =>
    wide ? `Normal ${name} <${value}` : `<${value}`
  const [showEveryReading, setShowEveryReading] = useState(false)
  const { points, aggregated } = chartPoints(readings, showEveryReading)
  const data: Slot[] = points.map((point, slot) => ({ ...point, slot }))
  const many = readings.length > AGGREGATE_THRESHOLD
  const { low, high, ticks } = yAxis(points)
  const dayOf = (slot: number) => shortDay(data[slot]?.time ?? 0)
  // Remount when the plotted data changes, resetting the Brush.
  const chartKey = `${data.length}-${data[0]?.time ?? 0}-${aggregated}`

  const dot = (color: string) =>
    data.length <= MAX_POINTS_WITH_DOTS
      ? { r: 4, strokeWidth: 2, fill: theme.surface, stroke: color }
      : false

  return (
    <figure
      aria-labelledby={captionId}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <figcaption
            id={captionId}
            className="text-xl font-semibold text-slate-900 dark:text-slate-100"
          >
            Blood pressure, {describeRange(range)}
          </figcaption>
          <p
            aria-live="polite"
            className="mt-1 text-sm text-slate-500 dark:text-slate-400"
          >
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
        </div>
        <LegendChips theme={theme} />
      </div>

      {data.length > 0 && (
        <div key={chartKey} className="mt-6 h-[320px] lg:h-[480px]">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 320, height: 320 }}
          >
            <LineChart
              data={data}
              margin={{ top: 8, right: wide ? 148 : 40, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis
                dataKey="slot"
                type="category"
                tickFormatter={dayOf}
                tick={{ fill: theme.muted, fontSize: 12 }}
                stroke={theme.grid}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                domain={[low, high]}
                ticks={ticks}
                allowDecimals={false}
                width={40}
                tick={{ fill: theme.muted, fontSize: 12 }}
                stroke={theme.grid}
              />
              <ReferenceLine
                y={NORMAL_SYSTOLIC_BELOW}
                stroke={theme.systolic}
                strokeOpacity={0.55}
                strokeDasharray="6 4"
                className="bp-normal-limit bp-normal-limit-systolic"
                label={{
                  value: limitLabel('systolic', NORMAL_SYSTOLIC_BELOW),
                  position: 'right',
                  fill: theme.muted,
                  fontSize: 12,
                }}
              />
              <ReferenceLine
                y={NORMAL_DIASTOLIC_BELOW}
                stroke={theme.diastolic}
                strokeOpacity={0.55}
                strokeDasharray="6 4"
                className="bp-normal-limit bp-normal-limit-diastolic"
                label={{
                  value: limitLabel('diastolic', NORMAL_DIASTOLIC_BELOW),
                  position: 'right',
                  fill: theme.muted,
                  fontSize: 12,
                }}
              />
              <Tooltip
                content={ChartTooltip}
                cursor={{ stroke: theme.muted, strokeDasharray: '4 4' }}
                isAnimationActive={false}
              />
              {(['systolic', 'diastolic'] as const).map((key) => (
                <Line
                  key={key}
                  type="linear"
                  dataKey={key}
                  name={SERIES_NAMES[key]}
                  stroke={theme[key]}
                  strokeWidth={2}
                  dot={dot(theme[key])}
                  activeDot={{
                    r: 6,
                    fill: theme[key],
                    stroke: theme.surface,
                    strokeWidth: 2,
                    className: 'transition-all duration-200',
                  }}
                  isAnimationActive={false}
                />
              ))}
              {data.length >= 2 && (
                <Brush
                  dataKey="slot"
                  height={32}
                  stroke={theme.muted}
                  fill={theme.surface}
                  travellerWidth={12}
                  tickFormatter={dayOf}
                  aria-label="Zoom: drag the handles to choose the readings shown"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
