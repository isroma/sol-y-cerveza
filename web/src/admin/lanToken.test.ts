import { describe, expect, it, vi } from 'vitest'
import {
  isLoopbackHost,
  newToken,
  pageToken,
  tokenAccepted,
  TOKEN_HEADER,
  withAdminToken,
} from './lanToken.ts'

describe('isLoopbackHost', () => {
  it('treats the default and loopback names as local', () => {
    expect(isLoopbackHost(undefined)).toBe(true)
    expect(isLoopbackHost(false)).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
  })

  it('treats --host and LAN addresses as exposed', () => {
    expect(isLoopbackHost(true)).toBe(false)
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('192.168.1.20')).toBe(false)
    expect(isLoopbackHost('::')).toBe(false)
  })
})

describe('tokenAccepted', () => {
  it('lets everything through in localhost mode', () => {
    expect(tokenAccepted(null, undefined)).toBe(true)
  })

  it('needs the exact token in LAN mode', () => {
    const token = newToken()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(tokenAccepted(token, token)).toBe(true)
    expect(tokenAccepted(token, undefined)).toBe(false)
    expect(tokenAccepted(token, '')).toBe(false)
    expect(tokenAccepted(token, `${token.slice(0, -1)}x`)).toBe(false)
    expect(tokenAccepted(token, [token])).toBe(false)
  })

  it('makes a new token every time', () => {
    expect(newToken()).not.toBe(newToken())
  })
})

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

describe('pageToken', () => {
  it('takes the token from the URL and remembers it for a reload', () => {
    const storage = memoryStorage()
    expect(pageToken('?token=abc', storage)).toBe('abc')
    expect(pageToken('', storage)).toBe('abc')
  })

  it('is null without one', () => {
    expect(pageToken('', memoryStorage())).toBeNull()
  })
})

describe('withAdminToken', () => {
  const origin = 'https://192.168.1.20:5173'

  it('adds the header to admin requests only', async () => {
    const base = vi.fn<typeof fetch>(() => Promise.resolve(new Response()))
    const wrapped = withAdminToken(base, 'secret', origin)
    await wrapped('/__admin/review', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    })
    await wrapped('./data/terraces.json')
    await wrapped('https://tiles.openfreemap.org/styles/liberty')
    const [first, second, third] = base.mock.calls
    const headers = new Headers(first?.[1]?.headers)
    expect(headers.get(TOKEN_HEADER)).toBe('secret')
    expect(headers.get('content-type')).toBe('application/json')
    expect(first?.[1]?.method).toBe('PUT')
    expect(second?.[1]).toBeUndefined()
    expect(third?.[1]).toBeUndefined()
  })
})
