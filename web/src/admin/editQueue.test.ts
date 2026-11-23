import { describe, expect, it } from 'vitest'
import {
  applyEdits,
  describeEdit,
  loadQueue,
  outcomeOf,
  parseQueue,
  priceEdit,
  QUEUE_STORAGE_KEY,
  replay,
  requestFor,
  reviewEdit,
  serializeQueue,
  type Edit,
} from './editQueue.ts'
import type { VenuePrice } from './pricesCsv.ts'
import type { Review } from './review.ts'

const review: Review = {
  venueId: 'osm:node/1',
  status: 'terrace',
  name: null,
  kind: null,
  venue: null,
  terrace: { lat: 38.879, lon: -6.97 },
  reviewed: '2026-11-23',
}

const cana: VenuePrice = {
  venueId: 'osm:node/1',
  item: 'cana',
  brand: null,
  cents: 150,
  seen: '2026-11-23',
}

describe('requestFor', () => {
  it('PUTs a review and DELETEs an undone one', () => {
    const put = requestFor(reviewEdit('osm:node/1', review))
    expect(put.url).toBe('/__admin/review')
    expect(put.init.method).toBe('PUT')
    expect(JSON.parse(String(put.init.body))).toEqual(review)
    const del = requestFor(reviewEdit('osm:node/1', null))
    expect(del.url).toBe('/__admin/review?venue_id=osm%3Anode%2F1')
    expect(del.init.method).toBe('DELETE')
  })

  it('PUTs and DELETEs prices', () => {
    expect(requestFor(priceEdit('osm:node/1|cana|', cana)).init.method).toBe(
      'PUT',
    )
    expect(requestFor(priceEdit('osm:node/1|cana|', null)).url).toBe(
      '/__admin/prices?key=osm%3Anode%2F1%7Ccana%7C',
    )
  })
})

describe('outcomeOf', () => {
  it('keeps edits the server could not take yet', () => {
    expect(outcomeOf(null)).toBe('retry')
    expect(outcomeOf(502)).toBe('retry')
    expect(outcomeOf(401)).toBe('retry')
  })

  it('drops edits the server refuses for good', () => {
    expect(outcomeOf(200)).toBe('saved')
    expect(outcomeOf(400)).toBe('rejected')
    expect(outcomeOf(405)).toBe('rejected')
  })
})

describe('replay', () => {
  const a = reviewEdit('osm:node/1', review)
  const b = priceEdit('osm:node/1|cana|', cana)
  const c = reviewEdit('osm:node/2', null)

  it('sends everything in order when the server is back', async () => {
    const sent: Edit[] = []
    const result = await replay([a, b, c], (edit) => {
      sent.push(edit)
      return Promise.resolve(200)
    })
    expect(sent).toEqual([a, b, c])
    expect(result).toEqual({ remaining: [], saved: [a, b, c], rejected: [] })
  })

  it('stops at the first edit that has to wait, keeping the order', async () => {
    const answers = [200, null, 200]
    const result = await replay([a, b, c], () =>
      Promise.resolve(answers.shift() ?? null),
    )
    expect(result.saved).toEqual([a])
    expect(result.remaining).toEqual([b, c])
  })

  it('drops refused edits and carries on', async () => {
    const answers = [400, 200, 200]
    const result = await replay([a, b, c], () =>
      Promise.resolve(answers.shift() ?? null),
    )
    expect(result.rejected).toEqual([{ edit: a, status: 400 }])
    expect(result.saved).toEqual([b, c])
    expect(result.remaining).toEqual([])
  })
})

describe('applyEdits', () => {
  it('lays the waiting edits over the server state, last one wins', () => {
    const server = new Map([
      ['osm:node/2', { ...review, venueId: 'osm:node/2' }],
    ])
    const { reviews, prices } = applyEdits(server, new Map(), [
      reviewEdit('osm:node/1', {
        ...review,
        status: 'no_terrace',
        terrace: null,
      }),
      reviewEdit('osm:node/1', review),
      reviewEdit('osm:node/2', null),
      priceEdit('osm:node/1|cana|', cana),
    ])
    expect([...reviews.values()]).toEqual([review])
    expect(prices.get('osm:node/1|cana|')).toEqual(cana)
    expect(server.size).toBe(1)
  })
})

describe('storage and export', () => {
  it('round-trips through the export file', () => {
    const queue = [reviewEdit('osm:node/1', review), priceEdit('k|cana|', null)]
    expect(parseQueue(serializeQueue(queue))).toEqual(queue)
  })

  it('rejects a file with an invalid edit', () => {
    const bad = JSON.stringify({
      edits: [
        { ...reviewEdit('osm:node/1', review), review: { venueId: 'x' } },
      ],
    })
    expect(() => parseQueue(bad)).toThrow()
  })

  it('loads an empty queue when storage is empty, missing or corrupt', () => {
    expect(loadQueue(null)).toEqual([])
    expect(loadQueue({ getItem: () => null })).toEqual([])
    expect(loadQueue({ getItem: () => '{oops' })).toEqual([])
    const stored = serializeQueue([reviewEdit('osm:node/1', review)])
    expect(
      loadQueue({ getItem: (k) => (k === QUEUE_STORAGE_KEY ? stored : null) }),
    ).toHaveLength(1)
  })
})

describe('describeEdit', () => {
  it('names the venue and the change', () => {
    const nameOf = () => 'Bar Plaza'
    expect(describeEdit(reviewEdit('osm:node/1', review), nameOf)).toBe(
      'Bar Plaza: terrace',
    )
    expect(describeEdit(priceEdit('osm:node/1|cana|', cana), nameOf)).toBe(
      'Bar Plaza: cana 1.50 €',
    )
  })
})
