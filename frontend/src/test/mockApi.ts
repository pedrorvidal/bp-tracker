import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { api } from '../lib/api'

export type MockReply = { status: number; data?: unknown } | 'network-error'

type Handler =
  MockReply | ((call: RecordedCall) => MockReply | Promise<MockReply>)

export interface RecordedCall {
  /** e.g. "POST /auth/login" */
  key: string
  body: unknown
  /** Value of the Authorization header, if any. */
  authorization: string | undefined
}

export interface MockApi {
  calls: RecordedCall[]
  /** Calls matching "METHOD /path". */
  callsTo: (key: string) => RecordedCall[]
}

const originalAdapter = api.defaults.adapter

function parseBody(data: unknown): unknown {
  if (typeof data !== 'string') {
    return data
  }
  try {
    return JSON.parse(data) as unknown
  } catch {
    return data
  }
}

/**
 * Replaces the api client's HTTP adapter with in-memory routes, keyed
 * "METHOD /path". An array replies to successive calls in order (the last
 * entry repeats). Interceptors still run, exactly as in production.
 */
export function mockApi(routes: Record<string, Handler | Handler[]>): MockApi {
  const calls: RecordedCall[] = []
  const counts = new Map<string, number>()

  const adapter: AxiosAdapter = async (
    config: InternalAxiosRequestConfig,
  ): Promise<AxiosResponse> => {
    const key = `${(config.method ?? 'get').toUpperCase()} ${config.url ?? ''}`
    const authorization = config.headers.get('Authorization')
    const call: RecordedCall = {
      key,
      body: parseBody(config.data),
      authorization:
        typeof authorization === 'string' ? authorization : undefined,
    }
    calls.push(call)

    const route = routes[key]
    if (route === undefined) {
      throw new Error(`Unhandled request in test: ${key}`)
    }

    const index = counts.get(key) ?? 0
    counts.set(key, index + 1)
    const handler = Array.isArray(route)
      ? route[Math.min(index, route.length - 1)]
      : route
    if (handler === undefined) {
      throw new Error(`Empty route in test: ${key}`)
    }

    const reply = typeof handler === 'function' ? await handler(call) : handler

    if (reply === 'network-error') {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config)
    }

    const response: AxiosResponse = {
      data: reply.data ?? null,
      status: reply.status,
      statusText: String(reply.status),
      headers: {},
      config,
    }

    if (reply.status >= 200 && reply.status < 300) {
      return response
    }

    throw new AxiosError(
      `Request failed with status code ${reply.status}`,
      reply.status >= 500
        ? AxiosError.ERR_BAD_RESPONSE
        : AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      response,
    )
  }

  api.defaults.adapter = adapter

  return {
    calls,
    callsTo: (key) => calls.filter((call) => call.key === key),
  }
}

export function restoreApi(): void {
  api.defaults.adapter = originalAdapter
}

/** WordPress REST error body. */
export function restError(code: string, message: string, status: number) {
  return { status, data: { code, message, data: { status } } }
}
