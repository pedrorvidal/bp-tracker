import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSession } from '../lib/authStore'
import { LIFETIME, lastDays } from '../lib/dateRange'
import { makeSession, makeStats } from '../test/fixtures'
import { mockApi, type RecordedCall } from '../test/mockApi'
import { renderWithProviders } from '../test/renderWithProviders'
import type { ReadingStats } from '../types'
import SummaryCard, { MIN_READINGS_TO_COMPARE } from './SummaryCard'

const TODAY = new Date(2026, 8, 23, 10, 15)

const CURRENT = makeStats({
  count: 12,
  systolic_average: 124.3,
  systolic_min: 112,
  systolic_max: 139,
  diastolic_average: 80,
  diastolic_min: 73,
  diastolic_max: 92,
  pulse_average: 66.5,
  pulse_min: 58,
  pulse_max: 80,
})

const PREVIOUS = makeStats({
  count: 10,
  systolic_average: 128.1,
  diastolic_average: 80,
  pulse_average: 64,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: TODAY })
  setSession(makeSession('a'))
})

afterEach(() => {
  vi.useRealTimers()
})

/** Answers /stats for the current period and, by period_start, the previous one. */
function mockStats(previous: ReadingStats) {
  return mockApi({
    'GET /stats': (call: RecordedCall) => ({
      status: 200,
      data:
        call.params.period_start === '2026-07-26T00:00:00-03:00'
          ? previous
          : CURRENT,
    }),
  })
}

describe('SummaryCard', () => {
  it('shows average, min and max of each measure for the period', async () => {
    mockStats(PREVIOUS)
    renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

    expect(
      await screen.findByRole('heading', { name: 'Summary, last 30 days' }),
    ).toBeInTheDocument()
    await screen.findByText('12 readings')

    const systolic = within(screen.getByRole('region')).getByText('Systolic')
      .parentElement as HTMLElement
    expect(systolic).toHaveTextContent('124.3 mmHg average')
    expect(systolic).toHaveTextContent('Min 112 · Max 139')
    expect(
      within(screen.getByRole('region')).getByText('Diastolic').parentElement,
    ).toHaveTextContent('80 mmHg averageMin 73 · Max 92')
    expect(
      within(screen.getByRole('region')).getByText('Pulse').parentElement,
    ).toHaveTextContent('66.5 bpm averageMin 58 · Max 80')
  })

  it('requests the current and the previous period of the same length', async () => {
    const http = mockStats(PREVIOUS)
    renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

    await waitFor(() => {
      expect(http.callsTo('GET /stats')).toHaveLength(2)
    })
    expect(http.calls.map((c) => c.params)).toEqual(
      expect.arrayContaining([
        {
          period_start: '2026-08-25T00:00:00-03:00',
          period_end: '2026-09-23T23:59:59-03:00',
        },
        {
          period_start: '2026-07-26T00:00:00-03:00',
          period_end: '2026-08-24T23:59:59-03:00',
        },
      ]),
    )
  })

  it('compares the averages with the previous period', async () => {
    mockStats(PREVIOUS)
    renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

    expect(
      await screen.findByText('3.8 mmHg lower than the previous 30 days'),
    ).toBeInTheDocument()
    expect(screen.getByText('Same as the previous 30 days')).toBeInTheDocument()
    expect(
      screen.getByText('2.5 bpm higher than the previous 30 days'),
    ).toBeInTheDocument()
  })

  it(`omits the comparison with fewer than ${MIN_READINGS_TO_COMPARE} readings before`, async () => {
    mockStats({ ...PREVIOUS, count: MIN_READINGS_TO_COMPARE - 1 })
    renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

    expect(
      await screen.findByText(
        'Not enough readings in the previous 30 days to compare.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/than the previous/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Same as the previous/)).not.toBeInTheDocument()
    // The rest of the card is intact.
    expect(screen.getByText('Min 112 · Max 139')).toBeInTheDocument()
  })

  it('omits the comparison for a measure missing in either period', async () => {
    mockStats({ ...PREVIOUS, pulse_average: null })
    renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

    await screen.findByText('3.8 mmHg lower than the previous 30 days')
    expect(screen.queryByText(/bpm (higher|lower)/)).not.toBeInTheDocument()
  })

  it('does not compare lifetime (nothing comes before it)', async () => {
    const http = mockApi({ 'GET /stats': { status: 200, data: CURRENT } })
    renderWithProviders(<SummaryCard range={LIFETIME} />)

    expect(
      await screen.findByRole('heading', { name: 'Summary, all time' }),
    ).toBeInTheDocument()
    await screen.findByText('Min 112 · Max 139')
    expect(http.callsTo('GET /stats')).toHaveLength(1)
    expect(http.calls[0]?.params).toEqual({})
    expect(screen.queryByText(/previous/)).not.toBeInTheDocument()
  })

  it('shows dashes when the period has no data', async () => {
    mockApi({ 'GET /stats': { status: 200, data: makeStats() } })
    renderWithProviders(<SummaryCard range={lastDays(7, TODAY)} />)

    await screen.findByText('0 readings')
    expect(screen.getAllByText('Min — · Max —')).toHaveLength(3)
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})
