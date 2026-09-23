import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSession } from '../lib/authStore'
import { makeSession, makeStats } from '../test/fixtures'
import { mockApi, restError, type RecordedCall } from '../test/mockApi'
import { renderWithProviders } from '../test/renderWithProviders'
import type { Reading } from '../types'
import History from './History'

// Tests run in America/Sao_Paulo (UTC-3); see vite.config.ts.
const NOW = new Date(2026, 8, 23, 10, 15)

const PERIOD_30 = {
  period_start: '2026-08-25T00:00:00-03:00',
  period_end: '2026-09-23T23:59:59-03:00',
}
const PERIOD_7 = {
  period_start: '2026-09-17T00:00:00-03:00',
  period_end: '2026-09-23T23:59:59-03:00',
}

// Newest first, as the API returns them.
const READINGS: Reading[] = [
  {
    id: 3,
    reading_datetime: '2026-09-23T07:45:00-03:00',
    systolic: 121,
    diastolic: 79,
    pulse: 66,
    weight: 72.4,
    notes: 'After coffee',
  },
  {
    id: 2,
    reading_datetime: '2026-09-20T21:10:00-03:00',
    systolic: 134,
    diastolic: 86,
    pulse: null,
    weight: null,
    notes: '',
  },
  {
    id: 1,
    reading_datetime: '2026-09-01T08:00:00-03:00',
    systolic: 118,
    diastolic: 75,
    pulse: null,
    weight: 70.1,
    notes: '',
  },
]

const STATS = makeStats({
  count: 3,
  systolic_average: 124.3,
  diastolic_average: 80,
  pulse_average: 68,
  systolic_min: 118,
  systolic_max: 134,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  setSession(makeSession('a'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function page(readings: Reading[]) {
  return {
    status: 200,
    data: readings,
    headers: {
      'x-wp-total': String(readings.length),
      'x-wp-totalpages': '1',
    },
  }
}

/** Mocks GET /readings and GET /stats; the list is mutable to simulate deletes. */
function mockHistory(readings: Reading[] = READINGS, stats = STATS) {
  const current = [...readings]
  const http = mockApi({
    'GET /readings': () => page(current),
    'GET /stats': { status: 200, data: stats },
    'DELETE /readings/2': () => {
      current.splice(
        current.findIndex((r) => r.id === 2),
        1,
      )
      return { status: 200, data: { deleted: true, id: 2 } }
    },
  })
  return http
}

function cards() {
  return within(screen.getByRole('list', { name: 'Readings' })).getAllByRole(
    'listitem',
  )
}

function periodCalls(calls: RecordedCall[], key: string) {
  return calls
    .filter((call) => call.key === key)
    .map(({ params }) => ({
      period_start: params.period_start,
      period_end: params.period_end,
    }))
}

describe('History', () => {
  describe('list', () => {
    it('renders the readings newest first, with pulse and weight only when present (both, neither, weight only)', async () => {
      mockHistory()
      renderWithProviders(<History />)

      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })
      const [newest, middle, oldest] = cards()

      expect(newest).toHaveTextContent('121/79 mmHg')
      expect(newest).toHaveTextContent('Pulse 66 bpm · Weight 72.4 kg')
      expect(newest).toHaveTextContent('After coffee')
      expect(
        within(newest as HTMLElement).getByText(/Sep 23, 2026/),
      ).toBeInTheDocument()

      expect(middle).toHaveTextContent('134/86 mmHg')
      expect(middle).not.toHaveTextContent('Pulse')
      expect(middle).not.toHaveTextContent('Weight')

      expect(oldest).toHaveTextContent('118/75 mmHg')
      expect(oldest).toHaveTextContent('Weight 70.1 kg')
      expect(oldest).not.toHaveTextContent('Pulse')
    })

    it('also renders a table (shown from md up) with the same rows', async () => {
      mockHistory()
      renderWithProviders(<History />)

      const table = await screen.findByRole('table', {
        name: 'Readings, newest first',
      })
      const rows = within(table).getAllByRole('row').slice(1)

      expect(rows).toHaveLength(3)
      expect(rows[0]).toHaveTextContent('121/79')
      expect(rows[1]).toHaveTextContent('134/86')
      expect(within(rows[1] as HTMLElement).getAllByText('—')).toHaveLength(2)
    })

    it('shows an empty state linking to the new-reading form', async () => {
      mockHistory([], makeStats())
      renderWithProviders(<History />)

      expect(
        await screen.findByText(/No readings for last 30 days\./),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Record a reading' }),
      ).toHaveAttribute('href', '/new')
    })

    it('shows an error with a retry button when readings fail to load', async () => {
      let fail = true
      mockApi({
        'GET /readings': () =>
          fail ? restError('internal', 'Boom.', 500) : page(READINGS),
        'GET /stats': { status: 200, data: STATS },
      })
      renderWithProviders(<History />)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not load your readings.')

      fail = false
      await userEvent.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      )

      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })
    })
  })

  describe('layout', () => {
    it('stacks period selector, summary, chart and list, in that order', async () => {
      mockHistory()
      renderWithProviders(<History />)
      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })

      const order = [
        screen.getByRole('group', { name: 'Period' }),
        screen.getByRole('region', { name: 'Summary, last 30 days' }),
        screen.getByRole('figure', { name: 'Blood pressure, last 30 days' }),
        screen.getByRole('heading', { name: 'Readings' }),
      ]
      for (let i = 1; i < order.length; i++) {
        const before = order[i - 1] as HTMLElement
        const after = order[i] as HTMLElement
        expect(
          before.compareDocumentPosition(after) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
      }
    })

    it('shows the summary of the selected period', async () => {
      mockHistory()
      renderWithProviders(<History />)

      const summary = await screen.findByRole('region', {
        name: 'Summary, last 30 days',
      })
      await waitFor(() => {
        expect(summary).toHaveTextContent('Avg systolic124.3 mmHg')
      })
      expect(summary).toHaveTextContent('Min 118 · Max 134')
    })
  })

  describe('period filter', () => {
    it('starts with the last 30 days', async () => {
      const http = mockHistory()
      renderWithProviders(<History />)

      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })
      expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(periodCalls(http.calls, 'GET /readings')).toEqual([PERIOD_30])
      expect(periodCalls(http.calls, 'GET /stats')).toContainEqual(PERIOD_30)
    })

    it('switching to 7 days queries readings and stats with the new period', async () => {
      const http = mockHistory()
      renderWithProviders(<History />)
      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })

      await userEvent.click(screen.getByRole('button', { name: '7 days' }))

      await waitFor(() => {
        expect(periodCalls(http.calls, 'GET /readings')).toEqual([
          PERIOD_30,
          PERIOD_7,
        ])
      })
      expect(periodCalls(http.calls, 'GET /stats')).toContainEqual(PERIOD_7)
      expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      expect(
        await screen.findByRole('region', { name: 'Summary, last 7 days' }),
      ).toBeInTheDocument()
    })

    it('lifetime queries readings and stats without a period', async () => {
      const http = mockHistory()
      renderWithProviders(<History />)
      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })

      await userEvent.click(screen.getByRole('button', { name: 'Lifetime' }))

      await waitFor(() => {
        expect(http.callsTo('GET /readings').at(-1)?.params).toEqual({
          per_page: 100,
          page: 1,
        })
      })
      expect(http.callsTo('GET /stats').at(-1)?.params).toEqual({})
      expect(
        await screen.findByRole('region', { name: 'Summary, all time' }),
      ).toBeInTheDocument()
    })

    it('a custom range queries its whole days', async () => {
      const http = mockHistory()
      renderWithProviders(<History />)
      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })

      await userEvent.click(screen.getByRole('button', { name: 'Custom' }))
      fireEvent.change(screen.getByLabelText('From'), {
        target: { value: '2026-09-01' },
      })
      fireEvent.change(screen.getByLabelText('To'), {
        target: { value: '2026-09-15' },
      })

      const custom = {
        period_start: '2026-09-01T00:00:00-03:00',
        period_end: '2026-09-15T23:59:59-03:00',
      }
      await waitFor(() => {
        expect(periodCalls(http.calls, 'GET /readings')).toContainEqual(custom)
      })
      expect(periodCalls(http.calls, 'GET /stats')).toContainEqual(custom)
    })

    it('fetches all pages for the chart (100 per page)', async () => {
      const http = mockHistory()
      renderWithProviders(<History />)

      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })
      expect(http.callsTo('GET /readings')[0]?.params).toMatchObject({
        per_page: 100,
        page: 1,
      })
    })
  })

  describe('chart', () => {
    it('renders a captioned chart of the period', async () => {
      mockHistory()
      renderWithProviders(<History />)

      expect(
        await screen.findByRole('figure', {
          name: 'Blood pressure, last 30 days',
        }),
      ).toBeInTheDocument()
      expect(screen.getByText('Showing 3 readings.')).toBeInTheDocument()
    })
  })

  describe('delete', () => {
    async function renderAndWait() {
      const http = mockHistory()
      renderWithProviders(<History />)
      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })
      return http
    }

    function deleteButtonOf(card: HTMLElement) {
      return within(card).getByRole('button', { name: /^Delete reading of/ })
    }

    it('labels each delete button with the reading it deletes', async () => {
      mockHistory()
      renderWithProviders(<History />)
      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })

      expect(deleteButtonOf(cards()[1] as HTMLElement)).toHaveAccessibleName(
        /^Delete reading of Sep 20, 2026, .*134\/86 mmHg$/,
      )
    })

    it('asks for confirmation and does nothing when cancelled', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const http = await renderAndWait()

      await userEvent.click(deleteButtonOf(cards()[1] as HTMLElement))

      expect(confirm).toHaveBeenCalledTimes(1)
      expect(confirm.mock.calls[0]?.[0]).toMatch(
        /^Delete the reading of Sep 20, 2026, .* \(134\/86 mmHg\)\? This can't be undone\.$/,
      )
      expect(http.callsTo('DELETE /readings/2')).toHaveLength(0)
      expect(cards()).toHaveLength(3)
    })

    it('deletes after confirmation, refreshes the list and announces it', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const http = await renderAndWait()
      const readsBefore = http.callsTo('GET /readings').length
      const statsBefore = http.callsTo('GET /stats').length

      await userEvent.click(deleteButtonOf(cards()[1] as HTMLElement))

      expect(confirm).toHaveBeenCalledTimes(1)
      expect(http.callsTo('DELETE /readings/2')).toHaveLength(1)
      expect(http.callsTo('DELETE /readings/2')[0]?.authorization).toBe(
        'Bearer access-a',
      )
      await waitFor(() => {
        expect(cards()).toHaveLength(2)
      })
      expect(screen.queryByText('134/86')).not.toBeInTheDocument()
      expect(http.callsTo('GET /readings').length).toBeGreaterThan(readsBefore)
      expect(http.callsTo('GET /stats').length).toBeGreaterThan(statsBefore)
      expect(screen.getByRole('status')).toHaveTextContent('Reading deleted.')
    })

    it('shows an error when the delete fails', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockApi({
        'GET /readings': page(READINGS),
        'GET /stats': { status: 200, data: STATS },
        'DELETE /readings/2': restError('internal', 'Boom.', 500),
      })
      renderWithProviders(<History />)
      await waitFor(() => {
        expect(cards()).toHaveLength(3)
      })

      await userEvent.click(deleteButtonOf(cards()[1] as HTMLElement))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Could not delete the reading. Try again.',
      )
      expect(cards()).toHaveLength(3)
    })
  })
})
