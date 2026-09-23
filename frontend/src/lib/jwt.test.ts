import { describe, expect, it } from 'vitest'
import { makeAccessToken } from '../test/fixtures'
import { getUserIdFromToken } from './jwt'

function tokenWithPayload(payload: string): string {
  return `eyJ0eXAiOiJKV1QifQ.${payload}.sig`
}

describe('getUserIdFromToken', () => {
  it('reads the user_id claim', () => {
    expect(getUserIdFromToken(makeAccessToken(42))).toBe(42)
  })

  it('decodes base64url payloads (with "-" and "_", no padding)', () => {
    // {"user_id":7,"x":"??>"} contains bytes that encode to "-" / "_" in base64url.
    const payload = btoa(JSON.stringify({ user_id: 7, x: '??>' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    expect(getUserIdFromToken(tokenWithPayload(payload))).toBe(7)
  })

  it.each([
    ['no payload segment', 'not-a-jwt'],
    ['a payload that is not JSON', tokenWithPayload(btoa('nope'))],
    ['no user_id', tokenWithPayload(btoa(JSON.stringify({ sub: 1 })))],
    [
      'a string user_id',
      tokenWithPayload(btoa(JSON.stringify({ user_id: '1' }))),
    ],
    ['a zero user_id', tokenWithPayload(btoa(JSON.stringify({ user_id: 0 })))],
  ])('throws for %s', (_label, token) => {
    expect(() => getUserIdFromToken(token)).toThrow()
  })
})
