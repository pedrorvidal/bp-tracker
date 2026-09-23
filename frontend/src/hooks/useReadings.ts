import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { api } from '../lib/api'
import type {
  ApiErrorResponse,
  Reading,
  ReadingInput,
  ReadingsQuery,
  ReadingStats,
} from '../types'

/** One page of GET /readings, with the totals from the X-WP-Total* headers. */
export interface ReadingsPage {
  readings: Reading[]
  total: number
  totalPages: number
}

/** Query keys for readings, so every cache entry can be invalidated at once. */
export const readingsKeys = {
  all: ['readings'] as const,
  list: (query: ReadingsQuery) => ['readings', 'list', query] as const,
  allInPeriod: (query: PeriodQuery) =>
    ['readings', 'all-in-period', query] as const,
  stats: (query: PeriodQuery) => ['readings', 'stats', query] as const,
}

/** Period filter accepted by GET /readings and GET /stats. */
export type PeriodQuery = Pick<ReadingsQuery, 'period_start' | 'period_end'>

/** Largest page the API serves. */
const MAX_PER_PAGE = 100

/** Safety cap on pages fetched for one period (10,000 readings). */
const MAX_PAGES = 100

function headerNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Lists the signed-in user's readings (newest first). */
export function useReadings(
  query: ReadingsQuery = {},
): UseQueryResult<ReadingsPage, AxiosError<ApiErrorResponse>> {
  return useQuery({
    queryKey: readingsKeys.list(query),
    queryFn: async ({ signal }) => {
      const response = await api.get<Reading[]>('/readings', {
        params: query,
        signal,
      })

      return {
        readings: response.data,
        total: headerNumber(response.headers['x-wp-total']),
        totalPages: headerNumber(response.headers['x-wp-totalpages']),
      }
    },
  })
}

/**
 * Every reading in a period, newest first, following pagination.
 *
 * For views that need the whole period at once (chart, list of a short
 * period). The first page tells how many pages there are; the rest are
 * fetched in parallel.
 */
export function useAllReadings(
  query: PeriodQuery,
): UseQueryResult<Reading[], AxiosError<ApiErrorResponse>> {
  return useQuery({
    queryKey: readingsKeys.allInPeriod(query),
    queryFn: async ({ signal }) => {
      const fetchPage = (page: number) =>
        api.get<Reading[]>('/readings', {
          params: { ...query, per_page: MAX_PER_PAGE, page },
          signal,
        })

      const first = await fetchPage(1)
      const totalPages = Math.min(
        MAX_PAGES,
        headerNumber(first.headers['x-wp-totalpages']),
      )
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) =>
          fetchPage(i + 2),
        ),
      )

      return [first, ...rest].flatMap((response) => response.data)
    },
  })
}

/** Averages and count for a period (GET /stats). */
export function useReadingStats(
  query: PeriodQuery,
): UseQueryResult<ReadingStats, AxiosError<ApiErrorResponse>> {
  return useQuery({
    queryKey: readingsKeys.stats(query),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<ReadingStats>('/stats', {
        params: query,
        signal,
      })
      return data
    },
  })
}

/** Deletes a reading by ID; refreshes readings and stats on success. */
export function useDeleteReading(): UseMutationResult<
  { deleted: boolean; id: number },
  AxiosError<ApiErrorResponse>,
  number
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.delete<{ deleted: boolean; id: number }>(
        `/readings/${id}`,
      )
      return data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: readingsKeys.all }),
  })
}

/** Creates a reading; refreshes every readings query on success. */
export function useCreateReading(): UseMutationResult<
  Reading,
  AxiosError<ApiErrorResponse>,
  ReadingInput
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ReadingInput) => {
      const { data } = await api.post<Reading>('/readings', input)
      return data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: readingsKeys.all }),
  })
}
