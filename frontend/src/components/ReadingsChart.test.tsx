import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AGGREGATE_THRESHOLD } from '../lib/aggregate'
import { LIFETIME } from '../lib/dateRange'
import { manyReadings } from '../test/fixtures'
import { MAX_POINTS_WITH_DOTS } from './BpPanel'
import ReadingsChart from './ReadingsChart'

// jsdom has no layout: give the charts a fixed size so real SVG renders.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  ResponsiveContainer: (await import('../test/rechartsFixedSize'))
    .FixedSizeContainer,
}))

const JUNE = { start: '2026-06-01', end: '2026-07-31' }

function renderChart(count: number, perDay = 3) {
  return render(
    <ReadingsChart readings={manyReadings(count, perDay)} range={JUNE} />,
  )
}

/** Plotted points per panel (dots are drawn up to MAX_POINTS_WITH_DOTS). */
function curves(container: HTMLElement) {
  return container.querySelectorAll('.recharts-line-curve')
}

function dots(container: HTMLElement) {
  return container.querySelectorAll('.recharts-line-dots circle')
}

describe('ReadingsChart', () => {
  it('plots every reading, in two panels, at or below the threshold', () => {
    const { container } = renderChart(12)

    expect(screen.getByText('Showing 12 readings.')).toBeInTheDocument()
    expect(screen.queryByText(/daily averages/)).not.toBeInTheDocument()
    expect(curves(container)).toHaveLength(2)
    expect(dots(container)).toHaveLength(24) // 12 per panel
  })

  it(`switches to daily averages above ${AGGREGATE_THRESHOLD} readings`, () => {
    renderChart(AGGREGATE_THRESHOLD + 20, 3) // 120 readings over 40 days

    expect(
      screen.getByText(/Showing daily averages \(40 days, 120 readings\)\./),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Show every reading' }),
    ).toBeInTheDocument()
  })

  it('aggregates to one point per day', () => {
    // 102 readings, 6 per day: 17 daily points.
    const { container } = renderChart(AGGREGATE_THRESHOLD + 2, 6)

    expect(screen.getByText(/17 days, 102 readings/)).toBeInTheDocument()
    expect(dots(container)).toHaveLength(17 * 2)
  })

  it('"Show every reading" plots the raw readings, and can be undone', async () => {
    const { container } = renderChart(AGGREGATE_THRESHOLD + 2, 6)

    await userEvent.click(
      screen.getByRole('button', { name: 'Show every reading' }),
    )

    expect(screen.getByText('Showing every reading (102).')).toBeInTheDocument()
    // Above MAX_POINTS_WITH_DOTS the dots are hidden, but both lines are drawn.
    expect(curves(container)).toHaveLength(2)
    expect(dots(container)).toHaveLength(0)

    await userEvent.click(
      screen.getByRole('button', { name: 'Show daily averages' }),
    )

    expect(screen.getByText(/17 days, 102 readings/)).toBeInTheDocument()
    expect(dots(container)).toHaveLength(17 * 2)
  })

  it(`draws dots up to ${MAX_POINTS_WITH_DOTS} points, then only the lines`, () => {
    const atLimit = renderChart(MAX_POINTS_WITH_DOTS)
    expect(dots(atLimit.container)).toHaveLength(MAX_POINTS_WITH_DOTS * 2)
    atLimit.unmount()

    const { container } = renderChart(MAX_POINTS_WITH_DOTS + 1)
    expect(dots(container)).toHaveLength(0)
    expect(curves(container)).toHaveLength(2)
  })

  it('draws the reference bands of each measure', () => {
    const { container } = renderChart(12)

    expect(container.querySelectorAll('.bp-zone')).toHaveLength(7)
    for (const category of ['normal', 'elevated', 'stage1', 'stage2']) {
      expect(
        container.querySelectorAll(`.bp-zone-${category}`).length,
      ).toBeGreaterThan(0)
    }
    // "Elevated" exists only for systolic.
    expect(container.querySelectorAll('.bp-zone-elevated')).toHaveLength(1)
  })

  it('renders the reference bands without breaking on an empty dataset', () => {
    for (const range of [JUNE, LIFETIME]) {
      const { container, unmount } = render(
        <ReadingsChart readings={[]} range={range} />,
      )

      expect(
        screen.getByText('No readings in this period.'),
      ).toBeInTheDocument()
      expect(container.querySelectorAll('.bp-zone')).toHaveLength(7)
      expect(dots(container)).toHaveLength(0)
      expect(container.querySelector('.recharts-brush')).toBeNull()
      unmount()
    }
  })

  it('adds a Brush for zoom/pan when there are at least two points', () => {
    const { container } = renderChart(12)

    expect(container.querySelectorAll('.recharts-brush')).toHaveLength(1)
  })

  it('has a legend for both lines and every reference band, with the caveat', () => {
    renderChart(12)

    const lines = screen.getByRole('list', { name: 'Lines' })
    expect(
      within(lines)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Systolic (mmHg)', 'Diastolic (mmHg)'])
    const bands = screen.getByRole('list', { name: 'Reference bands' })
    expect(
      within(bands)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Normal (below 120 / below 80)',
      'Elevated (120–129 / below 80)',
      'Stage 1 (130–139 or 80–89)',
      'Stage 2 (140 or higher, or 90 or higher)',
    ])
    expect(
      screen.getByText(/for reference only; they are not a diagnosis/),
    ).toBeInTheDocument()
  })

  it('is a captioned figure', () => {
    renderChart(12)

    expect(
      screen.getByRole('figure', {
        name: 'Blood pressure, Jun 1, 2026 – Jul 31, 2026',
      }),
    ).toBeInTheDocument()
  })
})
