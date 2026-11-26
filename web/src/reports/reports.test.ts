import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportVenue, sendChange, validName, type Report } from './reports.ts'

// The API and the bot check as a build with both configured has them.
vi.mock('../apiClient.ts', async (original) => {
  vi.stubEnv('VITE_PRICES_API', 'https://api.test')
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
  return original()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('validName', () => {
  it('takes 2 to 60 characters after cleaning, without links', () => {
    expect(validName('Bar Nuevo')).toBe(true)
    expect(validName(' a ')).toBe(false)
    expect(validName('x'.repeat(61))).toBe(false)
    expect(validName('www.bar.es')).toBe(false)
    expect(validName('Bar HTTPS')).toBe(false)
  })
})

describe('reportVenue', () => {
  it('posts the report with positions rounded to 6 decimals', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await reportVenue({
      kind: 'move',
      venueId: 'osm:node/1',
      lat: 38.87812345678,
      lon: -6.97012345678,
      token: 't',
    })
    expect(result).toBe('ok')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/reports',
      expect.objectContaining({ method: 'POST' }),
    )
    const init: unknown = fetchMock.mock.calls[0]?.at(1)
    const body =
      init && typeof init === 'object' && 'body' in init ? init.body : null
    expect(JSON.parse(String(body))).toEqual({
      kind: 'move',
      venueId: 'osm:node/1',
      lat: 38.878123,
      lon: -6.970123,
      token: 't',
    })
  })

  it('sends the terrace answer and the tables, rounded, in one change', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await sendChange({
        venueId: 'osm:node/1',
        token: 't',
        terrace: true,
        pin: { lat: 38.87812345678, lon: -6.97012345678 },
      }),
    ).toBe('ok')
    const init: unknown = fetchMock.mock.calls[0]?.at(1)
    const body =
      init && typeof init === 'object' && 'body' in init ? init.body : null
    expect(JSON.parse(String(body))).toEqual({
      venueId: 'osm:node/1',
      token: 't',
      terrace: true,
      pin: { lat: 38.878123, lon: -6.970123 },
    })
  })

  it('maps rate limits, bot checks and failures', async () => {
    const closed: Report = { kind: 'closed', venueId: 'osm:node/1', token: 't' }
    vi.stubGlobal('fetch', async () => new Response(null, { status: 429 }))
    expect(await reportVenue(closed)).toBe('rate-limited')
    vi.stubGlobal('fetch', async () => new Response(null, { status: 403 }))
    expect(await reportVenue(closed)).toBe('bot')
    vi.stubGlobal('fetch', async () => new Response(null, { status: 400 }))
    expect(await reportVenue(closed)).toBe('error')
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    expect(await reportVenue(closed)).toBe('error')
  })
})
