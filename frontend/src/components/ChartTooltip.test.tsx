import { render, screen } from '@testing-library/react'
import type { TooltipContentProps, TooltipValueType } from 'recharts'
import { describe, expect, it } from 'vitest'
import type { ChartPoint } from '../lib/aggregate'
import ChartTooltip from './ChartTooltip'

function renderTooltip(point: ChartPoint | undefined, active = true) {
  const props = {
    active,
    payload: point ? [{ payload: point }] : [],
  } as unknown as TooltipContentProps<TooltipValueType, string | number>
  return render(<ChartTooltip {...props} />)
}

function point(overrides: Partial<ChartPoint>): ChartPoint {
  return {
    time: new Date(2026, 8, 20, 21, 10).getTime(),
    systolic: 133,
    diastolic: 85,
    pulse: 72,
    count: 1,
    aggregated: false,
    ...overrides,
  }
}

describe('ChartTooltip', () => {
  it('shows the time, the reading as systolic/diastolic, pulse and category', () => {
    renderTooltip(point({}))

    expect(screen.getByText('Sep 20, 2026, 9:10 PM')).toBeInTheDocument()
    expect(screen.getByText(/^133\/85/)).toHaveTextContent('133/85 mmHg')
    expect(screen.getByText('Pulse 72 bpm')).toBeInTheDocument()
    expect(screen.getByText('Stage 1')).toBeInTheDocument()
  })

  it.each([
    [118, 76, 'Normal'],
    [125, 78, 'Elevated'],
    [118, 85, 'Stage 1'],
    [142, 70, 'Stage 2'],
    [125, 95, 'Stage 2'],
  ])('classifies %i/%i as %s (the more severe of the two)', (s, d, label) => {
    renderTooltip(point({ systolic: s, diastolic: d }))

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('marks the category with its color dot next to the name', () => {
    const { container } = renderTooltip(point({ systolic: 142, diastolic: 70 }))

    const dot = container.querySelector('[aria-hidden="true"].rounded-full')
    expect(dot).toHaveStyle({ backgroundColor: '#d03b3b' })
    expect(dot?.parentElement).toHaveTextContent('Stage 2')
  })

  it('describes a daily average', () => {
    renderTooltip(point({ aggregated: true, count: 3, systolic: 125.7 }))

    expect(
      screen.getByText('Sep 20, 2026 · average of 3 readings'),
    ).toBeInTheDocument()
    expect(screen.getByText(/^125\.7\/85/)).toBeInTheDocument()
  })

  it('omits pulse when not recorded, and renders nothing when inactive', () => {
    renderTooltip(point({ pulse: null }))
    expect(screen.queryByText(/Pulse/)).not.toBeInTheDocument()

    const { container } = renderTooltip(point({}), false)
    expect(container).toBeEmptyDOMElement()
  })
})
