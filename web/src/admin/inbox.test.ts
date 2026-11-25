import { describe, expect, it } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { describeItem, inboxItems, itemPoint, nextItem } from './inbox.ts'

const venue = (id: string, name: string): Terrace => ({
  id,
  name,
  kind: 'bar',
  venue: { lat: 38.878, lon: -6.97 },
  terrace: null,
  sources: ['overture'],
  verified: null,
  horizon: null,
})

const items = inboxItems({
  reports: [
    {
      ids: [3],
      kind: 'move',
      venueId: 'osm:node/1',
      lat: 38.8785,
      lon: -6.97,
      reporters: 2,
      last: '2026-11-25',
      owner: false,
    },
  ],
  suggestions: [
    {
      venue_id: 'osm:node/1',
      item: 'cana',
      brand: '',
      cents: 160,
      voters: 3,
      last: '2026-11-25',
    },
  ],
  candidates: [],
  junk: [
    { venue: venue('overture:a', 'Burger Express'), signals: ['takeaway'] },
    { venue: venue('overture:b', 'Kept Bar'), signals: ['far'] },
  ],
  kept: new Set(['overture:b']),
})

describe('the Inbox', () => {
  it('lists reports, suggestions, then likely non-venues not kept', () => {
    expect(items.map((i) => i.kind)).toEqual(['report', 'suggestion', 'junk'])
  })

  it('describes each row by its venue', () => {
    const venueOf = (id: string) =>
      id === 'osm:node/1'
        ? { name: 'Bar Uno', at: { lat: 38.878, lon: -6.97 } }
        : undefined
    expect(describeItem(items[0]!, venueOf)).toEqual({
      title: 'Bar Uno',
      detail: 'Moved · 56 m',
    })
    expect(describeItem(items[1]!, venueOf).detail).toBe(
      'Caña 1,60 € · 3 people',
    )
    expect(describeItem(items[2]!, venueOf)).toEqual({
      title: 'overture:a',
      detail: 'fast food or delivery',
    })
  })

  it('shows a report’s proposed point on the map', () => {
    expect(itemPoint(items[0]!)).toEqual({ lat: 38.8785, lon: -6.97 })
    expect(itemPoint(items[1]!)).toBeNull()
  })

  it('moves on to the next item, or back to the one before at the end', () => {
    expect(nextItem(items, items[0]!.key)?.key).toBe(items[1]!.key)
    expect(nextItem(items, items[2]!.key)?.key).toBe(items[1]!.key)
    expect(nextItem(items.slice(0, 1), items[0]!.key)).toBeNull()
  })
})
