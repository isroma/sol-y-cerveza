import { describe, expect, it } from 'vitest'
import {
  allowed,
  countEvents,
  MAX_EVENTS,
  needsVenue,
  parseEvents,
  STATS_DEFAULT_DAYS,
  STATS_MAX_DAYS,
  statsDays,
  statsSince,
} from './events.ts'

const VENUE = 'osm:node/1'
const isVenue = (id: string) => id === VENUE

describe('parseEvents', () => {
  it('reads names and values, a missing value as none', () => {
    expect(
      parseEvents({
        events: [{ name: 'open', value: 'phone' }, { name: 'card_back' }],
      }),
    ).toEqual([
      { name: 'open', value: 'phone' },
      { name: 'card_back', value: '' },
    ])
  })

  it('drops entries that are not {name, value?} with strings', () => {
    expect(
      parseEvents({
        events: [
          'open',
          null,
          { value: 'phone' },
          { name: 'open', value: 3 },
          { name: 7 },
          { name: 'locate' },
        ],
      }),
    ).toEqual([{ name: 'locate', value: '' }])
  })

  it.each([
    ['nope'],
    [null],
    [{}],
    [{ events: 'open' }],
    [
      {
        events: Array.from({ length: MAX_EVENTS + 1 }, () => ({
          name: 'open',
        })),
      },
    ],
  ])('refuses the malformed body %j', (body) => {
    expect(parseEvents(body)).toBeNull()
  })

  it(`accepts ${MAX_EVENTS} events`, () => {
    const events = Array.from({ length: MAX_EVENTS }, () => ({
      name: 'locate',
    }))
    expect(parseEvents({ events })).toHaveLength(MAX_EVENTS)
  })
})

describe('allowed', () => {
  it.each([
    ['open', 'phone'],
    ['open', 'desktop'],
    ['venue_open', VENUE],
    ['card_back', ''],
    ['time_change', '00'],
    ['time_change', '23'],
    ['filter', 'sunNow'],
    ['filter', 'onlyTerrace'],
    ['search', ''],
    ['locate', ''],
    ['add_open', ''],
    ['suggest_sent', ''],
    ['sun_report', ''],
  ])('counts %s %j', (name, value) => {
    expect(allowed({ name, value }, isVenue)).toBe(true)
  })

  it.each([
    ['opened', ''],
    ['toString', ''],
    ['__proto__', ''],
    ['open', ''],
    ['open', 'tablet'],
    ['venue_open', ''],
    ['venue_open', 'osm:node/2'],
    ['card_back', 'yes'],
    ['time_change', '24'],
    ['time_change', '7'],
    ['filter', 'kind'],
    ['search', 'cervecería'],
    ['locate', '38.87,-6.97'],
  ])('drops %s %j', (name, value) => {
    expect(allowed({ name, value }, isVenue)).toBe(false)
  })

  it('asks for the published venues only for venue events', () => {
    expect(needsVenue({ name: 'venue_open', value: VENUE })).toBe(true)
    expect(needsVenue({ name: 'open', value: 'phone' })).toBe(false)
    expect(needsVenue({ name: 'nope', value: '' })).toBe(false)
  })
})

describe('countEvents', () => {
  it('adds up duplicates and drops what is not allowed, in a stable order', () => {
    expect(
      countEvents(
        [
          { name: 'venue_open', value: VENUE },
          { name: 'open', value: 'phone' },
          { name: 'venue_open', value: VENUE },
          { name: 'venue_open', value: 'osm:node/2' },
          { name: 'filter', value: 'sunNow' },
          { name: 'search', value: 'text' },
          { name: 'filter', value: 'onlyTerrace' },
        ],
        isVenue,
      ),
    ).toEqual([
      { name: 'filter', value: 'onlyTerrace', count: 1 },
      { name: 'filter', value: 'sunNow', count: 1 },
      { name: 'open', value: 'phone', count: 1 },
      { name: 'venue_open', value: VENUE, count: 2 },
    ])
  })
})

describe('statsDays', () => {
  it.each([
    [null, STATS_DEFAULT_DAYS],
    ['', STATS_DEFAULT_DAYS],
    ['0', STATS_DEFAULT_DAYS],
    ['-3', STATS_DEFAULT_DAYS],
    ['2.5', STATS_DEFAULT_DAYS],
    ['abc', STATS_DEFAULT_DAYS],
    ['1', 1],
    ['7', 7],
    ['365', 365],
    ['10000', STATS_MAX_DAYS],
  ])('reads %j as %i', (param, days) => {
    expect(statsDays(param)).toBe(days)
  })
})

describe('statsSince', () => {
  it('counts back whole Madrid days, today included', () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Madrid.
    const now = new Date('2026-12-31T23:30:00Z')
    expect(statsSince(now, 1)).toBe('2027-01-01')
    expect(statsSince(now, 2)).toBe('2026-12-31')
    expect(statsSince(now, 30)).toBe('2026-12-03')
  })

  it('is not thrown off by the clocks changing', () => {
    // Summer time ended on 25 Oct 2026.
    expect(statsSince(new Date('2026-10-26T00:30:00Z'), 2)).toBe('2026-10-25')
  })
})
