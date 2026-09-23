import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGGREGATE_THRESHOLD } from '../lib/aggregate'
import { mockColorScheme, mockMediaQueries } from '../test/colorScheme'
import { manyReadings } from '../test/fixtures'
import { DARK, LIGHT } from './chartSeries'
import ReadingsChart, { MAX_POINTS_WITH_DOTS } from './ReadingsChart'

// jsdom has no layout: give the chart a fixed size so real SVG renders.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  ResponsiveContainer: (await import('../test/rechartsFixedSize'))
    .FixedSizeContainer,
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

const JUNE = { start: '2026-06-01', end: '2026-07-31' }

function renderChart(count: number, perDay = 3) {
  return render(
    <ReadingsChart readings={manyReadings(count, perDay)} range={JUNE} />,
  )
}

const charts = (c: HTMLElement) => c.querySelectorAll('svg.recharts-surface')
const curves = (c: HTMLElement) => c.querySelectorAll('.recharts-line-curve')
const dots = (c: HTMLElement) =>
  c.querySelectorAll('.recharts-line-dots circle')

describe('ReadingsChart', () => {
  describe('one chart', () => {
    it('draws systolic and diastolic in a single chart on a shared axis', () => {
      const { container } = renderChart(12)

      expect(charts(container)).toHaveLength(1)
      expect(curves(container)).toHaveLength(2)
    })

    it('uses one X position per reading (categorical axis)', () => {
      const { container } = renderChart(12)

      // One dot per reading on each line.
      expect(dots(container)).toHaveLength(24)
      const xs = [...container.querySelectorAll('.recharts-line-dots')][0]
      const positions = [...(xs?.querySelectorAll('circle') ?? [])].map((c) =>
        Number(c.getAttribute('cx')),
      )
      const gaps = positions.slice(1).map((x, i) => x - (positions[i] ?? 0))
      // Evenly spaced, whatever the time between readings.
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.5)
    })

    it('colors systolic red and diastolic blue (lines and dots)', () => {
      const { container } = renderChart(12)
      const [systolic, diastolic] = [...curves(container)]

      expect(systolic).toHaveAttribute('stroke', LIGHT.systolic)
      expect(diastolic).toHaveAttribute('stroke', LIGHT.diastolic)
      const dotGroups = container.querySelectorAll('.recharts-line-dots')
      expect(dotGroups[0]?.querySelector('circle')).toHaveAttribute(
        'stroke',
        LIGHT.systolic,
      )
      expect(dotGroups[1]?.querySelector('circle')).toHaveAttribute(
        'stroke',
        LIGHT.diastolic,
      )
    })

    it('switches to the dark palette when the OS prefers dark', () => {
      mockColorScheme(true)
      const { container } = renderChart(12)
      const [systolic, diastolic] = [...curves(container)]

      expect(systolic).toHaveAttribute('stroke', DARK.systolic)
      expect(diastolic).toHaveAttribute('stroke', DARK.diastolic)
    })

    it(`draws dots up to ${MAX_POINTS_WITH_DOTS} points, then only the lines`, () => {
      const atLimit = renderChart(MAX_POINTS_WITH_DOTS)
      expect(dots(atLimit.container)).toHaveLength(MAX_POINTS_WITH_DOTS * 2)
      atLimit.unmount()

      const { container } = renderChart(MAX_POINTS_WITH_DOTS + 1)
      expect(dots(container)).toHaveLength(0)
      expect(curves(container)).toHaveLength(2)
    })
  })

  describe('normal limits', () => {
    it('draws dashed reference lines at 120 (systolic) and 80 (diastolic), labelled', () => {
      const { container } = renderChart(12)

      const systolic = container.querySelector('.bp-normal-limit-systolic')
      const diastolic = container.querySelector('.bp-normal-limit-diastolic')
      expect(systolic?.querySelector('line')).toHaveAttribute(
        'stroke',
        LIGHT.systolic,
      )
      expect(systolic?.querySelector('line')).toHaveAttribute(
        'stroke-dasharray',
        '6 4',
      )
      expect(diastolic?.querySelector('line')).toHaveAttribute(
        'stroke',
        LIGHT.diastolic,
      )
      // Narrow screen (jsdom default): just the values.
      expect(screen.getByText('<120')).toBeInTheDocument()
      expect(screen.getByText('<80')).toBeInTheDocument()
    })

    it('spells the labels out on wide screens', () => {
      mockMediaQueries({ wide: true })
      renderChart(12)

      expect(screen.getByText('Normal systolic <120')).toBeInTheDocument()
      expect(screen.getByText('Normal diastolic <80')).toBeInTheDocument()
    })

    it('keeps the labels outside the plot area, so they never cover data', () => {
      for (const wide of [false, true]) {
        mockMediaQueries({ wide })
        const { container, unmount } = renderChart(12)

        const plotRight = Math.max(
          ...[
            ...container.querySelectorAll(
              '.recharts-cartesian-grid-horizontal line',
            ),
          ].map((line) => Number(line.getAttribute('x2'))),
        )
        const texts = wide
          ? ['Normal systolic <120', 'Normal diastolic <80']
          : ['<120', '<80']
        const labels = texts.map((text) =>
          within(container).getByText(text).closest('text'),
        )
        for (const label of labels) {
          expect(label).not.toBeNull()
          expect(Number(label?.getAttribute('x'))).toBeGreaterThanOrEqual(
            plotRight,
          )
        }
        unmount()
      }
    })

    it('places the lines exactly at 120 and 80 on the Y axis', () => {
      const { container } = renderChart(12)

      /** Y coordinate of the axis tick labelled `value`. */
      const tickY = (value: string) => {
        const tick = [
          ...container.querySelectorAll('.recharts-yAxis-tick-labels text'),
        ].find((t) => t.textContent === value)
        return Number(tick?.getAttribute('y'))
      }
      const lineY = (selector: string) =>
        Number(container.querySelector(`${selector} line`)?.getAttribute('y1'))

      expect(tickY('120')).toBeGreaterThan(0)
      expect(lineY('.bp-normal-limit-systolic')).toBeCloseTo(tickY('120'), 0)
      expect(lineY('.bp-normal-limit-diastolic')).toBeCloseTo(tickY('80'), 0)
    })

    it('no longer draws category background bands', () => {
      const { container } = renderChart(12)

      expect(container.querySelector('.recharts-reference-area')).toBeNull()
      expect(container.querySelector('.bp-zone')).toBeNull()
    })
  })

  describe('aggregation', () => {
    it(`plots every reading at or below ${AGGREGATE_THRESHOLD}`, () => {
      renderChart(12)

      expect(screen.getByText('Showing 12 readings.')).toBeInTheDocument()
      expect(screen.queryByText(/daily averages/)).not.toBeInTheDocument()
    })

    it(`switches to daily averages above ${AGGREGATE_THRESHOLD} readings`, () => {
      // 102 readings, 6 per day: 17 daily points.
      const { container } = renderChart(AGGREGATE_THRESHOLD + 2, 6)

      expect(
        screen.getByText(/Showing daily averages \(17 days, 102 readings\)\./),
      ).toBeInTheDocument()
      expect(dots(container)).toHaveLength(17 * 2)
    })

    it('"Show every reading" plots the raw readings, and can be undone', async () => {
      const { container } = renderChart(AGGREGATE_THRESHOLD + 2, 6)

      await userEvent.click(
        screen.getByRole('button', { name: 'Show every reading' }),
      )
      expect(
        screen.getByText('Showing every reading (102).'),
      ).toBeInTheDocument()
      expect(dots(container)).toHaveLength(0) // 102 points: lines only
      expect(curves(container)).toHaveLength(2)

      await userEvent.click(
        screen.getByRole('button', { name: 'Show daily averages' }),
      )
      expect(dots(container)).toHaveLength(17 * 2)
    })
  })

  it('adds a Brush for zoom/pan with at least two points', () => {
    const { container } = renderChart(12)

    expect(container.querySelectorAll('.recharts-brush')).toHaveLength(1)
  })

  it('shows a message and no chart for an empty dataset', () => {
    const { container } = render(<ReadingsChart readings={[]} range={JUNE} />)

    expect(screen.getByText('No readings in this period.')).toBeInTheDocument()
    expect(charts(container)).toHaveLength(0)
  })

  it('has a legend of chips for both lines and the normal limits', () => {
    renderChart(12)

    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Systolic', 'Diastolic', 'Normal limits (<120 / <80)'])
    const [systolicChip] = within(legend).getAllByRole('listitem')
    expect(systolicChip?.querySelector('[aria-hidden="true"]')).toHaveStyle({
      backgroundColor: LIGHT.systolic,
    })
  })

  it('is a captioned card', () => {
    renderChart(12)

    const figure = screen.getByRole('figure', {
      name: 'Blood pressure, Jun 1, 2026 – Jul 31, 2026',
    })
    expect(figure.className).toMatch(/rounded-2xl/)
    expect(figure.className).toMatch(/dark:bg-slate-900/)
  })
})
