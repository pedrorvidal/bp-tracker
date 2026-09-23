import { useId } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type LabelProps,
} from 'recharts'
import { formatDateTime } from '../lib/format'
import type { Period } from '../lib/period'
import type { Reading } from '../types'

/**
 * Series colors: slots 1 and 2 of the validated categorical palette
 * (CVD ΔE 24.7, normal-vision ΔE 33.6, both >= 3:1 on white). Text never uses
 * them: labels, ticks and the legend use slate text colors.
 */
const SERIES = {
  systolic: { name: 'Systolic', color: '#2a78d6' },
  diastolic: { name: 'Diastolic', color: '#eb6834' },
} as const

const TEXT = '#334155' // slate-700
const MUTED = '#475569' // slate-600
const GRID = '#e2e8f0' // slate-200

interface ReadingsChartProps {
  readings: Reading[]
  period: Period
  days: number
}

interface Point {
  time: number
  systolic: number
  diastolic: number
}

/** Day ticks: every day for short periods, weekly for longer ones. */
function dayTicks(period: Period, days: number): number[] {
  const step = days <= 7 ? 1 : 7
  const ticks: number[] = []
  for (let offset = 0; offset < days; offset += step) {
    const day = new Date(period.start)
    day.setDate(day.getDate() + offset)
    ticks.push(day.getTime())
  }
  return ticks
}

function shortDay(time: number): string {
  return new Date(time).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

/** Direct label naming the series at its last point. */
function endLabel(name: string, lastIndex: number) {
  return function EndLabel({ x, y, index }: LabelProps & { index?: number }) {
    if (index !== lastIndex || typeof x !== 'number' || typeof y !== 'number') {
      return null
    }
    return (
      <text x={x + 10} y={y} dy={4} fill={TEXT} fontSize={12}>
        {name}
      </text>
    )
  }
}

/** Systolic and diastolic over the selected period, oldest to newest. */
export default function ReadingsChart({
  readings,
  period,
  days,
}: ReadingsChartProps) {
  const captionId = useId()
  const points: Point[] = readings
    .map((reading) => ({
      time: Date.parse(reading.reading_datetime),
      systolic: reading.systolic,
      diastolic: reading.diastolic,
    }))
    .sort((a, b) => a.time - b.time)

  const values = points.flatMap((p) => [p.systolic, p.diastolic])
  // Round ticks every 10 mmHg (20 for wide ranges), with at least 5 mmHg of
  // headroom so no point sits on the plot's edge.
  const min = Math.min(...values)
  const max = Math.max(...values)
  const step = max - min > 50 ? 20 : 10
  const low = Math.floor((min - 5) / step) * step
  const high = Math.ceil((max + 5) / step) * step
  const yTicks: number[] = []
  for (let tick = low; tick <= high; tick += step) {
    yTicks.push(tick)
  }
  const lastIndex = points.length - 1

  return (
    <figure
      aria-labelledby={captionId}
      className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6"
    >
      <figcaption
        id={captionId}
        className="text-base font-semibold text-slate-900 sm:text-lg"
      >
        Blood pressure, last {days} days (mmHg)
      </figcaption>

      {points.length < 2 ? (
        <p className="mt-2 text-slate-700">
          Record at least two readings in this period to see a trend.
        </p>
      ) : (
        <div className="mt-2 h-64 md:h-80">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 320, height: 256 }}
          >
            <LineChart
              data={points}
              margin={{ top: 8, right: 72, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={[period.start.getTime(), period.end.getTime() + 1000]}
                ticks={dayTicks(period, days)}
                tickFormatter={shortDay}
                tick={{ fill: MUTED, fontSize: 12 }}
                stroke={GRID}
                minTickGap={8}
              />
              <YAxis
                domain={[low, high]}
                ticks={yTicks}
                allowDecimals={false}
                width={36}
                tick={{ fill: MUTED, fontSize: 12 }}
                stroke={GRID}
              />
              <Tooltip
                cursor={{ stroke: MUTED, strokeDasharray: '4 4' }}
                labelFormatter={(time) =>
                  formatDateTime(new Date(Number(time)).toISOString())
                }
                formatter={(value, name) => [`${String(value)} mmHg`, name]}
                contentStyle={{ borderRadius: 8, borderColor: GRID }}
                labelStyle={{ color: TEXT, fontWeight: 600 }}
                itemStyle={{ color: TEXT }}
              />
              <Legend
                verticalAlign="top"
                align="left"
                height={32}
                iconType="plainline"
                // Systolic first, as the value is read (120/80), not alphabetical.
                itemSorter={(item) =>
                  item.value === SERIES.systolic.name ? 0 : 1
                }
                formatter={(value: string) => (
                  <span style={{ color: TEXT, fontSize: 13 }}>{value}</span>
                )}
              />
              {(['systolic', 'diastolic'] as const).map((key) => (
                <Line
                  key={key}
                  type="linear"
                  dataKey={key}
                  name={SERIES[key].name}
                  stroke={SERIES[key].color}
                  strokeWidth={2}
                  dot={{
                    r: 4,
                    strokeWidth: 2,
                    fill: '#ffffff',
                    stroke: SERIES[key].color,
                  }}
                  activeDot={{ r: 6, stroke: '#ffffff', strokeWidth: 2 }}
                  label={endLabel(SERIES[key].name, lastIndex)}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}
