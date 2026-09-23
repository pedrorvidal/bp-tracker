import { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { setSession } from '../lib/authStore'
import { makeSession } from '../test/fixtures'
import { mockApi } from '../test/mockApi'
import { createWrapper } from '../test/renderWithProviders'
import type { Reading } from '../types'
import { readingsKeys, useCreateReading, useReadings } from './useReadings'

const reading: Reading = {
  id: 7,
  reading_datetime: '2026-09-23T08:30:00-03:00',
  systolic: 118,
  diastolic: 76,
  pulse: 65,
  weight: null,
  notes: '',
}

describe('useReadings', () => {
  it('fetches the readings with the query params and exposes the totals', async () => {
    setSession(makeSession('a'))
    const http = mockApi({
      'GET /readings': {
        status: 200,
        data: [reading],
        headers: { 'x-wp-total': '31', 'x-wp-totalpages': '4' },
      },
    })

    const { result } = renderHook(
      () => useReadings({ per_page: 10, page: 2 }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual({
      readings: [reading],
      total: 31,
      totalPages: 4,
    })
    expect(http.calls[0]?.authorization).toBe('Bearer access-a')
  })

  it('treats missing total headers as zero', async () => {
    setSession(makeSession('a'))
    mockApi({ 'GET /readings': { status: 200, data: [] } })

    const { result } = renderHook(() => useReadings(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual({
        readings: [],
        total: 0,
        totalPages: 0,
      })
    })
  })
})

describe('useCreateReading', () => {
  it('posts the input, returns the created reading and refreshes readings queries', async () => {
    setSession(makeSession('a'))
    const http = mockApi({
      'POST /readings': { status: 201, data: reading },
    })
    const queryClient = new QueryClient()
    queryClient.setQueryData(readingsKeys.list({}), {
      readings: [],
      total: 0,
      totalPages: 0,
    })

    const { result } = renderHook(() => useCreateReading(), {
      wrapper: createWrapper({ queryClient }),
    })

    let created: Reading | undefined
    await act(async () => {
      created = await result.current.mutateAsync({
        reading_datetime: '2026-09-23T08:30:00-03:00',
        systolic: 118,
        diastolic: 76,
        pulse: 65,
      })
    })

    expect(created).toEqual(reading)
    expect(http.callsTo('POST /readings')[0]?.body).toEqual({
      reading_datetime: '2026-09-23T08:30:00-03:00',
      systolic: 118,
      diastolic: 76,
      pulse: 65,
    })
    expect(
      queryClient.getQueryState(readingsKeys.list({}))?.isInvalidated,
    ).toBe(true)
  })
})
