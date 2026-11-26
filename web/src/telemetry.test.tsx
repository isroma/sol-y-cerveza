import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS } from './filters/filters.ts'
import {
  EVENTS,
  FILTER_KEYS,
  HOURS,
  MAX_EVENTS,
} from './data/telemetryEvents.ts'

const API = 'https://api.test'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  // Earlier modules' listeners stay on the window: drain them into this test's mock.
  window.dispatchEvent(new Event('pagehide'))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
  window.localStorage.clear()
})

/** A fresh telemetry module, with or without an API in the build. */
async function load(api = API) {
  vi.stubEnv('VITE_PRICES_API', api)
  return import('./telemetry.ts')
}

/** The events of every request sent so far, one array per request. */
function sent(): unknown[] {
  return fetchMock.mock.calls.map(([, init]: unknown[]) => {
    const body =
      typeof init === 'object' && init !== null && 'body' in init
        ? init.body
        : null
    return typeof body === 'string' ? JSON.parse(body) : null
  })
}

describe('telemetry', () => {
  it('counts the page load and sends events together after a few seconds', async () => {
    const { startTelemetry, track, FLUSH_DELAY_MS } = await load()
    startTelemetry()
    track('card_back')
    track('filter', 'sunNow')
    expect(fetchMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(FLUSH_DELAY_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/v1/events`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        keepalive: true,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      }),
    )
    expect(sent()).toEqual([
      {
        events: [
          { name: 'open', value: 'desktop' },
          { name: 'card_back' },
          { name: 'filter', value: 'sunNow' },
        ],
      },
    ])
  })

  it(`sends at once when ${MAX_EVENTS} events wait`, async () => {
    const { startTelemetry, track } = await load()
    startTelemetry()
    for (let n = 1; n < MAX_EVENTS; n++) track('locate')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    track('locate')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [first] = sent()
    expect(first).toMatchObject({
      events: expect.arrayContaining([{ name: 'locate' }]),
    })
    expect(JSON.stringify(first).match(/"name"/g)).toHaveLength(MAX_EVENTS)
  })

  it('sends what waits when the page is hidden', async () => {
    const { startTelemetry, trackSettled } = await load()
    startTelemetry()
    trackSettled('time_change', '18')
    window.dispatchEvent(new Event('pagehide'))
    expect(sent()).toEqual([
      {
        events: [
          { name: 'open', value: 'desktop' },
          { name: 'time_change', value: '18' },
        ],
      },
    ])
  })

  it('counts a settled value once the visitor stops changing it', async () => {
    const { startTelemetry, flush, trackSettled, SETTLE_MS } = await load()
    startTelemetry()
    trackSettled('time_change', '10')
    vi.advanceTimersByTime(SETTLE_MS - 1)
    trackSettled('time_change', '11')
    vi.advanceTimersByTime(SETTLE_MS - 1)
    trackSettled('time_change', '12')
    vi.advanceTimersByTime(SETTLE_MS)
    flush()
    expect(sent()).toEqual([
      {
        events: [
          { name: 'open', value: 'desktop' },
          { name: 'time_change', value: '12' },
        ],
      },
    ])
  })

  it('counts a once-per-load event only the first time', async () => {
    const { startTelemetry, flush, trackOnce } = await load()
    startTelemetry()
    trackOnce('search')
    trackOnce('search')
    flush()
    expect(sent()).toEqual([
      { events: [{ name: 'open', value: 'desktop' }, { name: 'search' }] },
    ])
  })

  it('never throws when the request fails', async () => {
    fetchMock.mockImplementation(() => {
      throw new Error('offline')
    })
    const { startTelemetry, flush } = await load()
    startTelemetry()
    expect(() => flush()).not.toThrow()
    fetchMock.mockRejectedValue(new Error('offline'))
    const again = await load()
    expect(() => again.track('locate')).not.toThrow()
  })

  it('does nothing before startTelemetry (the admin, tests)', async () => {
    const { flush, track } = await load()
    track('locate')
    flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing without an API', async () => {
    const { flush, startTelemetry, track } = await load('')
    startTelemetry()
    track('locate')
    flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['Global Privacy Control', 'globalPrivacyControl', true],
    ['Do Not Track', 'doNotTrack', '1'],
  ])('does nothing with %s', async (_, property, value) => {
    vi.stubGlobal('navigator', { ...navigator, [property]: value })
    const { flush, startTelemetry, track } = await load()
    startTelemetry()
    track('locate')
    flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing in owner mode', async () => {
    window.localStorage.setItem('sol-y-cerveza-owner', 'the-owner-token')
    const { flush, startTelemetry, track } = await load()
    startTelemetry()
    track('locate')
    flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the allowlist', () => {
  it('has the filters the app has', () => {
    expect([...FILTER_KEYS].sort()).toEqual(Object.keys(DEFAULT_FILTERS).sort())
  })

  it('has every hour, as the app shows them', () => {
    expect(HOURS).toHaveLength(24)
    expect(HOURS[0]).toBe('00')
    expect(HOURS[23]).toBe('23')
  })

  it('names events in snake case', () => {
    for (const name of Object.keys(EVENTS)) expect(name).toMatch(/^[a-z_]+$/)
  })
})
