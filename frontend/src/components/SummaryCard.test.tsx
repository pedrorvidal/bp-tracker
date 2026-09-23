import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSession } from '../lib/authStore'
import { LIFETIME, lastDays } from '../lib/dateRange'
import { makeSession, makeStats } from '../test/fixtures'
import { mockApi, type RecordedCall } from '../test/mockApi'
import { renderWithProviders } from '../test/renderWithProviders'
import type { Reading, ReadingStats } from '../types'
import SummaryCard, { MIN_READINGS_TO_COMPARE } from './SummaryCard'

// Tests run in America/Sao_Paulo (UTC-3); see vite.config.ts.
const TODAY = new Date(2026, 8, 23, 10, 15)
const PREVIOUS_START = '2026-07-26T00:00:00-03:00'

const CURRENT = makeStats({
  count: 5,
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

/** 2 normal, 1 elevated, 1 stage 1 (by diastolic), 1 stage 2. */
const READINGS: Reading[] = [
  [118, 76],
  [115, 70],
  [125, 75],
  [118, 85],
  [150, 70],
].map(([systolic, diastolic], i) => ({
  id: i + 1,
  reading_datetime: `2026-09-${String(10 + i).padStart(2, '0')}T08:00:00-03:00`,
  systolic: systolic as number,
  diastolic: diastolic as number,
  pulse: null,
  weight: null,
  notes: '',
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: TODAY })
  setSession(makeSession('a'))
})

afterEach(() => {
  vi.useRealTimers()
})

function mockSummary(
  previous: ReadingStats = PREVIOUS,
  current: ReadingStats = CURRENT,
  readings: Reading[] = READINGS,
) {
  return mockApi({
    'GET /stats': (call: RecordedCall) => ({
      status: 200,
      data: call.params.period_start === PREVIOUS_START ? previous : current,
    }),
    'GET /readings': {
      status: 200,
      data: readings,
      headers: { 'x-wp-totalpages': '1' },
    },
  })
}

/** The mini-card whose label is `label`. */
async function card(label: string) {
  const term = await screen.findByText(label, { selector: 'dt' })
  return term.parentElement as HTMLElement
}

/** The change line of a mini-card (waits for the previous period to load). */
function changeIn(label: string): Promise<HTMLElement> {
  return waitFor(async () => {
    const change = (await card(label)).querySelector<HTMLElement>(
      '[data-change]',
    )
    expect(change).not.toBeNull()
    return change as HTMLElement
  })
}

describe('SummaryCard', () => {
  it('shows four mini-cards: average systolic, diastolic, pulse and readings', async () => {
    mockSummary()
    renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

    expect(
      await screen.findByRole('heading', { name: 'Summary, last 30 days' }),
    ).toBeInTheDocument()
    expect(await card('Avg systolic')).toHaveTextContent('124.3 mmHg')
    expect(await card('Avg systolic')).toHaveTextContent('Min 112 · Max 139')
    expect(await card('Avg diastolic')).toHaveTextContent('80 mmHg')
    expect(await card('Avg diastolic')).toHaveTextContent('Min 73 · Max 92')
    expect(await card('Avg pulse')).toHaveTextContent('66.5 bpm')
    expect(await card('Readings')).toHaveTextContent('5readings in the period')
  })

  it('shows the numbers large and with tabular figures', async () => {
    mockSummary()
    renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

    const value = within(await card('Avg systolic')).getByText('124.3')
    expect(value.className).toMatch(/text-3xl/)
    expect(value.className).toMatch(/font-bold/)
    expect(value.className).toMatch(/tabular-nums/)
  })

  describe('comparison with the previous period', () => {
    it('requests the previous period of the same length', async () => {
      const http = mockSummary()
      renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

      await waitFor(() => {
        expect(http.callsTo('GET /stats')).toHaveLength(2)
      })
      expect(http.callsTo('GET /stats').map((c) => c.params)).toContainEqual({
        period_start: PREVIOUS_START,
        period_end: '2026-08-24T23:59:59-03:00',
      })
    })

    it('colors a drop in blood pressure green', async () => {
      mockSummary()
      renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

      const change = await changeIn('Avg systolic')
      expect(change).toHaveTextContent(
        '3.8 mmHg lower than the previous 30 days',
      )
      expect(change).toHaveAttribute('data-change', 'down')
      expect(change.firstElementChild?.className).toMatch(/text-emerald-700/)
    })

    it('colors a rise in blood pressure red', async () => {
      mockSummary({ ...PREVIOUS, systolic_average: 120 })
      renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

      const change = await changeIn('Avg systolic')
      expect(change).toHaveTextContent(
        '4.3 mmHg higher than the previous 30 days',
      )
      expect(change.firstElementChild?.className).toMatch(/text-red-700/)
    })

    it('keeps "no change" and pulse neutral (no judgement color)', async () => {
      mockSummary()
      renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

      const same = await changeIn('Avg diastolic')
      expect(same).toHaveTextContent('Same as the previous 30 days')
      expect(same.firstElementChild?.className).toMatch(/text-slate-600/)
      const pulse = await changeIn('Avg pulse')
      expect(pulse).toHaveTextContent(
        '2.5 bpm higher than the previous 30 days',
      )
      expect(pulse.firstElementChild?.className).toMatch(/text-slate-600/)
      expect(pulse.firstElementChild?.className).not.toMatch(/text-red/)
    })

    it(`is omitted with fewer than ${MIN_READINGS_TO_COMPARE} readings before`, async () => {
      mockSummary({ ...PREVIOUS, count: MIN_READINGS_TO_COMPARE - 1 })
      renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

      expect(
        await screen.findByText(
          'Not enough readings in the previous 30 days to compare.',
        ),
      ).toBeInTheDocument()
      expect(document.querySelector('[data-change]')).toBeNull()
      // The cards themselves are intact.
      expect(await card('Avg systolic')).toHaveTextContent('Min 112 · Max 139')
    })

    it('is omitted for lifetime, without requesting a previous period', async () => {
      const http = mockSummary()
      renderWithProviders(<SummaryCard range={LIFETIME} />)

      expect(
        await screen.findByRole('heading', { name: 'Summary, all time' }),
      ).toBeInTheDocument()
      await card('Avg systolic')
      expect(http.callsTo('GET /stats')).toHaveLength(1)
      expect(http.callsTo('GET /stats')[0]?.params).toEqual({})
      expect(screen.queryByText(/previous/)).not.toBeInTheDocument()
    })
  })

  describe('category distribution', () => {
    it('counts the period’s readings per category, as pills', async () => {
      mockSummary()
      renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

      const list = await screen.findByRole('list', {
        name: 'Readings by category',
      })
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((li) => li.getAttribute('aria-label')),
      ).toEqual(['2 Normal', '1 Elevated', '1 Stage 1', '1 Stage 2'])
    })

    it('leaves out categories with no readings', async () => {
      mockSummary(PREVIOUS, CURRENT, READINGS.slice(0, 2))
      renderWithProviders(<SummaryCard range={lastDays(30, TODAY)} />)

      const list = await screen.findByRole('list', {
        name: 'Readings by category',
      })
      expect(within(list).getAllByRole('listitem')).toHaveLength(1)
      expect(within(list).getByRole('listitem')).toHaveAttribute(
        'aria-label',
        '2 Normal',
      )
    })

    it('reuses the readings query (same key as the history list)', async () => {
      const http = mockSummary()
      renderWithProviders(
        <>
          <SummaryCard range={lastDays(30, TODAY)} />
          <SummaryCard range={lastDays(30, TODAY)} />
        </>,
      )

      await screen.findAllByRole('list', { name: 'Readings by category' })
      expect(http.callsTo('GET /readings')).toHaveLength(1)
    })
  })

  it('shows dashes and no distribution for an empty period', async () => {
    mockSummary(PREVIOUS, makeStats(), [])
    renderWithProviders(<SummaryCard range={lastDays(7, TODAY)} />)

    expect(await card('Readings')).toHaveTextContent('0')
    expect(await card('Avg systolic')).toHaveTextContent('— mmHg')
    expect(await card('Avg systolic')).toHaveTextContent('Min — · Max —')
    expect(
      screen.queryByRole('list', { name: 'Readings by category' }),
    ).not.toBeInTheDocument()
  })
})
