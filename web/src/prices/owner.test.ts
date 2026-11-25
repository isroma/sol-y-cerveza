import { afterEach, describe, expect, it, vi } from 'vitest'
import { exitOwner, ownerPost, tokenFromHash } from './owner.ts'

describe('owner link', () => {
  it('takes only a long token from #owner=', () => {
    expect(tokenFromHash('#owner=0123456789abcdef0123')).toBe(
      '0123456789abcdef0123',
    )
    expect(tokenFromHash('#owner=short')).toBeNull()
    expect(tokenFromHash('#other=0123456789abcdef0123')).toBeNull()
  })
})

describe('ownerPost', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends nothing outside owner mode', async () => {
    exitOwner()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await ownerPost('/v1/owner/changes', {})).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
  })
})
