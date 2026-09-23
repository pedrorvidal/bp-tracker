import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartPoint } from '../lib/aggregate'
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  ZONE_OPACITY,
  type Zone,
} from '../lib/bpCategory'
import ChartTooltip from './ChartTooltip'
import { GRID, MUTED, SERIES } from './chartSeries'

/** Charts sharing this id sync their tooltip cursor and Brush range. */
export const SYNC_ID = 'bp-history'

const HALF_DAY = 12 * 60 * 60 * 1000

/**
 * Above this many points, dots are left out (they crowd each other on a
 * phone); the line shows the trend and hovering still highlights a point.
 */
export const MAX_POINTS_WITH_DOTS = 31

interface BpPanelProps {
  measure: 'systolic' | 'diastolic'
  points: ChartPoint[]
  zones: Zone[]
  /** Y range always shown, so the reference bands stay visible. */
  baseDomain: [number, number]
  /** X range when there's no data (e.g. the selected period). */
  emptyDomain: [number, number]
  /** Show the tooltip box (the other panel only shows the synced cursor). */
  showTooltip: boolean
  /** Show the X axis labels and the Brush (bottom panel). */
  isBottom: boolean
  className: string
}

function shortDay(time: number): string {
  return new Date(time).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

/** Round Y bounds covering the data and the base range, with 5 mmHg headroom. */
function yDomain(
  points: ChartPoint[],
  key: 'systolic' | 'diastolic',
  base: [number, number],
) {
  const values = points.map((p) => p[key])
  const min = Math.min(base[0], ...values.map((v) => v - 5))
  const max = Math.max(base[1], ...values.map((v) => v + 5))
  const step = max - min > 80 ? 20 : 10
  const low = Math.floor(min / step) * step
  const high = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let tick = low; tick <= high; tick += step) ticks.push(tick)
  return { low, high, ticks }
}

/** One measure over time, on top of its clinical reference bands. */
export default function BpPanel({
  measure,
  points,
  zones,
  baseDomain,
  emptyDomain,
  showTooltip,
  isBottom,
  className,
}: BpPanelProps) {
  const series = SERIES[measure]
  const { low, high, ticks } = yDomain(points, measure, baseDomain)
  const empty = points.length === 0
  // Recharts drops reference areas when there's no data. Two value-less
  // placeholder points at the ends of the period keep the axes and bands
  // (no line or dot is drawn for them).
  const data: Array<ChartPoint | { time: number }> = empty
    ? [{ time: emptyDomain[0] }, { time: emptyDomain[1] }]
    : points

  return (
    <div className={className}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 320, height: 200 }}
      >
        <LineChart
          data={data}
          syncId={SYNC_ID}
          // Room on the right for the band labels, outside the data area.
          margin={{ top: 8, right: 64, bottom: 0, left: 0 }}
        >
          {zones.map((zone) => (
            <ReferenceArea
              key={zone.category}
              y1={zone.from ?? low}
              y2={zone.to ?? high}
              fill={CATEGORY_COLORS[zone.category]}
              fillOpacity={ZONE_OPACITY}
              stroke="none"
              ifOverflow="hidden"
              className={`bp-zone bp-zone-${zone.category}`}
              // Name the band directly (tints alone are hard to tell apart),
              // in text color, beside the plot so it never covers data.
              label={{
                value: CATEGORY_LABELS[zone.category],
                position: 'right',
                fill: MUTED,
                fontSize: 11,
              }}
            />
          ))}
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={
              empty
                ? emptyDomain
                : ([min, max]: readonly number[]) =>
                    min === max
                      ? [(min ?? 0) - HALF_DAY, (max ?? 0) + HALF_DAY]
                      : [min ?? 0, max ?? 0]
            }
            tickFormatter={shortDay}
            tick={isBottom ? { fill: MUTED, fontSize: 12 } : false}
            height={isBottom ? 24 : 4}
            stroke={GRID}
            minTickGap={24}
            padding={{ left: 8, right: 8 }}
          />
          <YAxis
            domain={[low, high]}
            // Use the domain as given even with no data (empty chart); it
            // already covers every value, so nothing gets clipped.
            allowDataOverflow
            ticks={ticks}
            allowDecimals={false}
            width={36}
            tick={{ fill: MUTED, fontSize: 12 }}
            stroke={GRID}
          />
          <Tooltip
            cursor={{ stroke: MUTED, strokeDasharray: '4 4' }}
            content={showTooltip ? ChartTooltip : () => null}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey={measure}
            name={series.name}
            stroke={series.color}
            strokeWidth={2}
            dot={
              points.length <= MAX_POINTS_WITH_DOTS
                ? {
                    r: 4,
                    strokeWidth: 2,
                    fill: '#ffffff',
                    stroke: series.color,
                  }
                : false
            }
            activeDot={{
              r: 6,
              stroke: '#ffffff',
              strokeWidth: 2,
              fill: series.color,
            }}
            isAnimationActive={false}
          />
          {isBottom && points.length >= 2 && (
            <Brush
              dataKey="time"
              height={32}
              stroke={MUTED}
              travellerWidth={12}
              tickFormatter={shortDay}
              aria-label="Zoom: drag the handles to choose the time range"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
