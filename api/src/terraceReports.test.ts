import { describe, expect, it } from 'vitest'
import { distanceMetres } from '../../web/src/data/geo.ts'
import {
  MAX_MOVE_METRES,
  MAX_PIN_METRES,
  maxDistance,
  parseReport,
  reportQueue,
  type ReportRow,
} from './reports.ts'

// Terrace reports (#210, ADR-0009): `terrace` yes/no and `pin`.

const answer = {
  kind: 'terrace',
  venueId: 'osm:node/1',
  terrace: false,
  token: 't',
}
const pin = {
  kind: 'pin',
  venueId: 'osm:node/1',
  lat: 38.87812345678,
  lon: -6.97,
  token: 't',
}

const row = (fields: Partial<ReportRow>): ReportRow => ({
  id: 1,
  by_owner: 0,
  kind: 'terrace',
  venue_id: 'osm:node/1',
  name: '',
  venue_kind: '',
  lat: null,
  lon: null,
  terrace: 1,
  net_hash: 'n1',
  created_at: '2026-11-24T10:00:00.000Z',
  ...fields,
})

describe('parseReport for terraces', () => {
  it('accepts a yes/no answer and a terrace position', () => {
    expect(parseReport(answer)).toEqual({
      ok: true,
      value: { kind: 'terrace', venueId: 'osm:node/1', terrace: false },
      token: 't',
    })
    // A stray position on an answer is ignored, as for closed.
    expect(parseReport({ ...answer, lat: 1, lon: 2 })).toMatchObject({
      ok: true,
      value: { kind: 'terrace' },
    })
    expect(parseReport(pin)).toEqual({
      ok: true,
      value: { kind: 'pin', venueId: 'osm:node/1', lat: 38.878123, lon: -6.97 },
      token: 't',
    })
  })

  it.each([
    ['terrace', { ...answer, terrace: 'no' }],
    ['terrace', { ...answer, terrace: undefined }],
    ['venueId', { ...answer, venueId: 'google:1' }],
    ['lat', { ...pin, lat: undefined }],
    ['lon', { ...pin, lon: -6.5 }],
  ])('refuses a bad %s', (error, body) => {
    expect(parseReport(body)).toEqual({ ok: false, error })
  })
})

describe('maxDistance', () => {
  it('keeps a pin within 150 m of the venue and a move within 500 m', () => {
    expect(
      maxDistance({ kind: 'pin', venueId: 'osm:node/1', lat: 0, lon: 0 }),
    ).toBe(MAX_PIN_METRES)
    expect(
      maxDistance({ kind: 'move', venueId: 'osm:node/1', lat: 0, lon: 0 }),
    ).toBe(MAX_MOVE_METRES)
    expect(
      maxDistance({ kind: 'terrace', venueId: 'osm:node/1', terrace: true }),
    ).toBeNull()
    const venue = { lat: 38.878, lon: -6.97 }
    expect(distanceMetres(venue, { lat: 38.8793, lon: -6.97 })).toBeLessThan(
      MAX_PIN_METRES,
    )
    expect(distanceMetres(venue, { lat: 38.8794, lon: -6.97 })).toBeGreaterThan(
      MAX_PIN_METRES,
    )
  })
})

describe('reportQueue for terraces', () => {
  it('groups answers per venue and answer, so the yes and no counts both show', () => {
    const queue = reportQueue([
      row({ id: 1, net_hash: 'a' }),
      row({ id: 2, net_hash: 'b', created_at: '2026-11-24T12:00:00.000Z' }),
      row({ id: 3, net_hash: 'b' }),
      row({ id: 4, terrace: 0, net_hash: 'c' }),
      row({
        id: 5,
        kind: 'pin',
        terrace: null,
        lat: 38.878,
        lon: -6.97,
        created_at: '2026-11-24T09:00:00.000Z',
      }),
    ])
    expect(queue).toEqual([
      {
        ids: [1, 2, 3],
        kind: 'terrace',
        venueId: 'osm:node/1',
        terrace: true,
        reporters: 2,
        owner: false,
        last: '2026-11-24T12:00:00.000Z',
      },
      {
        ids: [4],
        kind: 'terrace',
        venueId: 'osm:node/1',
        terrace: false,
        reporters: 1,
        owner: false,
        last: '2026-11-24T10:00:00.000Z',
      },
      {
        ids: [5],
        kind: 'pin',
        venueId: 'osm:node/1',
        lat: 38.878,
        lon: -6.97,
        reporters: 1,
        owner: false,
        last: '2026-11-24T09:00:00.000Z',
      },
    ])
  })
})
