import { afterEach, describe, expect, it, vi } from 'vitest'
import { logIn, logOut, ownerPost, useOwner } from './owner.ts'
import { renderHook } from '@testing-library/react'

// A build with the API configured.
vi.mock('../apiClient.ts', async (original) => {
  vi.stubEnv('VITE_PRICES_API', 'https://api.test')
  return original()
})

afterEach(() => {
  vi.unstubAllGlobals()
  logOut()
})

const answer = (status: number, body?: unknown) =>
  vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
  )

describe('logIn', () => {
  it('keeps the token the API hands out', async () => {
    const fetch = answer(200, { token: 'the-owner-token' })
    vi.stubGlobal('fetch', fetch)
    expect(await logIn('dueño', 'secreto')).toBe('ok')
    expect(renderHook(() => useOwner()).result.current.token).toBe(
      'the-owner-token',
    )
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/v1/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'dueño', password: 'secreto' }),
      }),
    )
    logOut()
    expect(renderHook(() => useOwner()).result.current.token).toBeNull()
  })

  it.each([
    [401, 'wrong'],
    [429, 'too-many'],
    [500, 'error'],
  ])('reads %i as %s', async (status, result) => {
    vi.stubGlobal('fetch', answer(status, { error: 'x' }))
    expect(await logIn('dueño', 'secreto')).toBe(result)
    expect(renderHook(() => useOwner()).result.current.token).toBeNull()
  })
})

describe('ownerPost', () => {
  it('sends nothing when logged out', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await ownerPost('/v1/owner/changes', {})).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
  })
})
