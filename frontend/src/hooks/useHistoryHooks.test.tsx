import { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setSession } from '../lib/authStore'
import { makeSession } from '../test/fixtures'
import { mockApi, type RecordedCall } from '../test/mockApi'
import { createWrapper } from '../test/renderWithProviders'
import type { Reading } from '../types'
import {
  readingsKeys,
  useAllReadings,
  useDeleteReading,
  useStats,
} from './useReadings'

const PERIOD = {
  period_start: '2026-09-17T00:00:00-03:00',
  period_end: '2026-09-23T23:59:59-03:00',
}

function reading(id: number): Reading {
  return {
    id,
    reading_datetime: '2026-09-20T08:00:00-03:00',
    systolic: 120,
    diastolic: 80,
    pulse: null,
    weight: null,
    notes: '',
  }
}

describe('useAllReadings', () => {
  it('follows pagination (100 per page) and concatenates the pages in order', async () => {
    setSession(makeSession('a'))
    const http = mockApi({
      'GET /readings': (call: RecordedCall) => {
        const page = Number(call.params.page)
        return {
          status: 200,
          data: page === 1 ? [reading(1), reading(2)] : [reading(page + 10)],
          headers: { 'x-wp-total': '4', 'x-wp-totalpages': '3' },
        }
      },
    })

    const { result } = renderHook(() => useAllReadings(PERIOD), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.map((r) => r.id)).toEqual([1, 2, 12, 13])
    expect(http.calls.map((c) => c.params)).toEqual([
      { ...PERIOD, per_page: 100, page: 1 },
      { ...PERIOD, per_page: 100, page: 2 },
      { ...PERIOD, per_page: 100, page: 3 },
    ])
  })

  it('makes a single request when everything fits in one page', async () => {
    setSession(makeSession('a'))
    const http = mockApi({
      'GET /readings': {
        status: 200,
        data: [reading(1)],
        headers: { 'x-wp-totalpages': '1' },
      },
    })

    const { result } = renderHook(() => useAllReadings(PERIOD), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1)
    })
    expect(http.calls).toHaveLength(1)
  })
})

describe('useStats', () => {
  it('fetches /stats for the period', async () => {
    setSession(makeSession('a'))
    const stats = {
      count: 3,
      systolic_average: 121.3,
      diastolic_average: 79,
      pulse_average: null,
    }
    const http = mockApi({ 'GET /stats': { status: 200, data: stats } })

    const { result } = renderHook(() => useStats(PERIOD), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual(stats)
    })
    expect(http.calls[0]?.params).toEqual(PERIOD)
  })
})

describe('useDeleteReading', () => {
  it('deletes by ID and refreshes readings and stats queries', async () => {
    setSession(makeSession('a'))
    const http = mockApi({
      'DELETE /readings/7': { status: 200, data: { deleted: true, id: 7 } },
    })
    const queryClient = new QueryClient()
    queryClient.setQueryData(readingsKeys.allInPeriod(PERIOD), [reading(7)])
    queryClient.setQueryData(readingsKeys.stats(PERIOD), { count: 1 })

    const { result } = renderHook(() => useDeleteReading(), {
      wrapper: createWrapper({ queryClient }),
    })

    await act(async () => {
      await result.current.mutateAsync(7)
    })

    expect(http.callsTo('DELETE /readings/7')).toHaveLength(1)
    expect(http.calls[0]?.authorization).toBe('Bearer access-a')
    expect(
      queryClient.getQueryState(readingsKeys.allInPeriod(PERIOD))
        ?.isInvalidated,
    ).toBe(true)
    expect(
      queryClient.getQueryState(readingsKeys.stats(PERIOD))?.isInvalidated,
    ).toBe(true)
  })
})
