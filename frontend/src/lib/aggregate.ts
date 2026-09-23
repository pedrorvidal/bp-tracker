import type { Reading } from '../types'
import { toDateInputValue } from './dateRange'

/** Above this many readings, the chart shows daily averages by default. */
export const AGGREGATE_THRESHOLD = 100

/** One point of the chart: a single reading, or a day's average. */
export interface ChartPoint {
  /** Epoch ms: the reading's time, or local noon of the averaged day. */
  time: number
  systolic: number
  diastolic: number
  pulse: number | null
  /** Readings behind this point (1 for a single reading). */
  count: number
  aggregated: boolean
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Every reading as its own point, oldest first. */
export function rawPoints(readings: Reading[]): ChartPoint[] {
  return readings
    .map((reading) => ({
      time: Date.parse(reading.reading_datetime),
      systolic: reading.systolic,
      diastolic: reading.diastolic,
      pulse: reading.pulse,
      count: 1,
      aggregated: false,
    }))
    .sort((a, b) => a.time - b.time)
}

/**
 * One point per local day with the averages of its readings, oldest first.
 * Pulse averages only the readings that recorded one.
 */
export function dailyAverages(readings: Reading[]): ChartPoint[] {
  const days = new Map<string, Reading[]>()
  for (const reading of readings) {
    const day = toDateInputValue(new Date(reading.reading_datetime))
    days.set(day, [...(days.get(day) ?? []), reading])
  }

  return [...days.entries()]
    .map(([day, group]) => {
      const [year, month, date] = day.split('-').map(Number) as [
        number,
        number,
        number,
      ]
      const pulses = group.flatMap((r) => (r.pulse === null ? [] : [r.pulse]))
      const mean = (values: number[]) =>
        round1(values.reduce((sum, v) => sum + v, 0) / values.length)

      return {
        time: new Date(year, month - 1, date, 12).getTime(),
        systolic: mean(group.map((r) => r.systolic)),
        diastolic: mean(group.map((r) => r.diastolic)),
        pulse: pulses.length > 0 ? mean(pulses) : null,
        count: group.length,
        aggregated: true,
      }
    })
    .sort((a, b) => a.time - b.time)
}

/**
 * The points to plot: daily averages when there are more than
 * AGGREGATE_THRESHOLD readings (unless the user asked for every reading).
 */
export function chartPoints(
  readings: Reading[],
  showEveryReading: boolean,
): { points: ChartPoint[]; aggregated: boolean } {
  const aggregate = readings.length > AGGREGATE_THRESHOLD && !showEveryReading
  return {
    points: aggregate ? dailyAverages(readings) : rawPoints(readings),
    aggregated: aggregate,
  }
}
