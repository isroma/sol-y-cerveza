import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function client(api: string) {
  vi.stubEnv('VITE_PRICES_API', api)
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
  return import('./apiClient.ts')
}

describe('postJson', () => {
  it('posts JSON to the API path', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { postJson } = await client('https://api.test')
    expect(await postJson('/v1/reports', { a: 1 })).toBe('ok')
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/v1/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    })
  })

  it('maps the answer to what the visitor is told', async () => {
    const { postJson } = await client('https://api.test')
    for (const [status, result] of [
      [429, 'rate-limited'],
      [403, 'bot'],
      [400, 'error'],
      [500, 'error'],
    ] as const) {
      vi.stubGlobal('fetch', async () => new Response(null, { status }))
      expect(await postJson('/v1/changes', {})).toBe(result)
    }
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    expect(await postJson('/v1/changes', {})).toBe('error')
  })

  it('sends nothing without an API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { CAN_SEND, postJson } = await client('')
    expect(CAN_SEND).toBe(false)
    expect(await postJson('/v1/changes', {})).toBe('error')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
