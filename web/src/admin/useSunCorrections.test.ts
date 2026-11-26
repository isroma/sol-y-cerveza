import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_ENDPOINTS } from './endpoints.ts'
import { syncSunCorrections } from './useSunCorrections.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const accepted = (id: number) => ({
  id,
  venueId: 'osm:node/1',
  leafOff: false,
  azimuth: 176.34,
  altitude: 27.06,
  at: '2026-11-25T12:31:04.000Z',
})

const inCsv = (id: number) => ({
  id,
  venueId: 'osm:node/1',
  leafOff: false,
  azimuth: 1,
  altitude: 2,
  seen: '2026-11-20T12:00:00.000Z',
})

type Post = { url: string; body: unknown }

/** The dev server: the API's accepted reports and the CSV's rows. */
function stub(api: Response, csv: unknown[], post = json({ added: 1 })) {
  const posts: Post[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) })
        return post
      }
      if (url === ADMIN_ENDPOINTS.sunAccepted) return api
      if (url === ADMIN_ENDPOINTS.sunCorrections) return json(csv)
      return json({ error: 'not found' }, 404)
    }),
  )
  return posts
}

describe('syncSunCorrections', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts only the accepted reports the CSV lacks', async () => {
    const posts = stub(
      json({ reports: [accepted(3), accepted(5), accepted(8)] }),
      [inCsv(3), inCsv(5)],
    )
    expect(await syncSunCorrections()).toEqual({ added: 1, skipped: [] })
    expect(posts).toEqual([
      {
        url: ADMIN_ENDPOINTS.sunCorrections,
        body: {
          rows: [
            {
              id: 8,
              venueId: 'osm:node/1',
              leafOff: false,
              azimuth: 176.3,
              altitude: 27.1,
              seen: '2026-11-25T12:31:04.000Z',
            },
          ],
        },
      },
    ])
  })

  it('writes nothing when every accepted report is there', async () => {
    const posts = stub(json({ reports: [accepted(3)] }), [inCsv(3), inCsv(4)])
    expect(await syncSunCorrections()).toEqual({ added: 0, skipped: [] })
    expect(posts).toEqual([])
  })

  it('skips a report the CSV cannot hold and still adds the others', async () => {
    const posts = stub(
      json({
        reports: [{ ...accepted(2), venueId: 'osm:relation/7' }, accepted(3)],
      }),
      [],
    )
    expect(await syncSunCorrections()).toEqual({ added: 1, skipped: [2] })
    expect(posts.map((p) => p.body)).toMatchObject([{ rows: [{ id: 3 }] }])
  })

  it('says why it failed, without throwing', async () => {
    stub(json({ error: 'set VITE_PRICES_API' }, 503), [])
    expect(await syncSunCorrections()).toEqual({ error: 'set VITE_PRICES_API' })
    stub(json({ reports: [{ id: 'x' }] }), [])
    expect(await syncSunCorrections()).toHaveProperty('error')
    stub(json({ reports: [accepted(1)] }), [], json({ error: 'bad' }, 400))
    expect(await syncSunCorrections()).toEqual({ error: 'HTTP 400' })
  })
})
