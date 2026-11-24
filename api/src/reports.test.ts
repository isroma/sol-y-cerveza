import { describe, expect, it } from 'vitest'
import {
  cleanName,
  distanceMetres,
  MAX_MOVE_METRES,
  parseReport,
  parseResolution,
  reportQueue,
  type ReportRow,
} from './reports.ts'

const move = {
  kind: 'move',
  venueId: 'osm:node/1',
  lat: 38.878,
  lon: -6.97,
  token: 't',
}
const closed = { kind: 'closed', venueId: 'osm:node/1', token: 't' }
const add = {
  kind: 'add',
  name: 'Bar Nuevo',
  venueKind: 'bar',
  terrace: true,
  lat: 38.878,
  lon: -6.97,
  token: 't',
}

describe('parseReport', () => {
  it('accepts each kind of report', () => {
    expect(parseReport(move)).toEqual({
      ok: true,
      value: { kind: 'move', venueId: 'osm:node/1', lat: 38.878, lon: -6.97 },
      token: 't',
    })
    expect(parseReport({ ...closed, lat: 1, lon: 2 })).toEqual({
      ok: true,
      value: { kind: 'closed', venueId: 'osm:node/1' },
      token: 't',
    })
    expect(parseReport(add)).toEqual({
      ok: true,
      value: {
        kind: 'add',
        name: 'Bar Nuevo',
        venueKind: 'bar',
        terrace: true,
        lat: 38.878,
        lon: -6.97,
      },
      token: 't',
    })
  })

  it('rounds positions to 6 decimals', () => {
    const parsed = parseReport({
      ...move,
      lat: 38.87812345678,
      lon: -6.9701234567,
    })
    expect(
      parsed.ok &&
        parsed.value.kind === 'move' && [parsed.value.lat, parsed.value.lon],
    ).toEqual([38.878123, -6.970123])
  })

  it.each([
    ['kind', { ...move, kind: 'rename' }],
    ['venueId', { ...move, venueId: 'google:123' }],
    ['venueId', { ...closed, venueId: undefined }],
    ['lat', { ...move, lat: 38.95 }],
    ['lat', { ...add, lat: '38.878' }],
    ['lon', { ...move, lon: -7.1 }],
    ['lon', { ...add, lon: Number.NaN }],
    ['name', { ...add, name: 'B' }],
    ['name', { ...add, name: 'x'.repeat(61) }],
    ['name', { ...add, name: 'www.bar.es' }],
    ['name', { ...add, name: 'Visit HTTP bar' }],
    ['name', { ...add, name: 42 }],
    ['venueKind', { ...add, venueKind: 'disco' }],
    ['terrace', { ...add, terrace: 'yes' }],
    ['token', { ...closed, token: '' }],
  ])('refuses a bad %s', (error, body) => {
    expect(parseReport(body)).toEqual({ ok: false, error })
  })

  it('refuses a body that is not an object', () => {
    expect(parseReport(null)).toEqual({ ok: false, error: 'body' })
  })
})

describe('cleanName', () => {
  it('turns commas, quotes and line breaks into spaces and collapses whitespace', () => {
    expect(cleanName('  Bar "El Patio",\n  Badajoz ')).toBe(
      'Bar El Patio Badajoz',
    )
    expect(cleanName('La «Tasca» de ‘Pepe’')).toBe('La Tasca de Pepe')
  })

  it('counts length after cleaning', () => {
    expect(parseReport({ ...add, name: ' "A" ' })).toEqual({
      ok: false,
      error: 'name',
    })
  })
})

describe('distanceMetres', () => {
  it('measures short distances in Badajoz', () => {
    // 0.001° of latitude is about 111 m.
    expect(
      distanceMetres({ lat: 38.878, lon: -6.97 }, { lat: 38.879, lon: -6.97 }),
    ).toBeCloseTo(111.2, 0)
    expect(
      distanceMetres({ lat: 38.878, lon: -6.97 }, { lat: 38.878, lon: -6.97 }),
    ).toBe(0)
  })

  it('separates a correction from a relocation', () => {
    const venue = { lat: 38.878, lon: -6.97 }
    expect(distanceMetres(venue, { lat: 38.8823, lon: -6.97 })).toBeLessThan(
      MAX_MOVE_METRES,
    )
    expect(distanceMetres(venue, { lat: 38.883, lon: -6.97 })).toBeGreaterThan(
      MAX_MOVE_METRES,
    )
  })
})

const row = (fields: Partial<ReportRow>): ReportRow => ({
  id: 1,
  kind: 'closed',
  venue_id: 'osm:node/1',
  name: '',
  venue_kind: '',
  lat: null,
  lon: null,
  terrace: null,
  net_hash: 'n1',
  created_at: '2026-11-24T10:00:00.000Z',
  ...fields,
})

describe('reportQueue', () => {
  it('groups closed per venue, counting distinct networks, and keeps the others per row', () => {
    const queue = reportQueue([
      row({ id: 9, net_hash: 'n2', created_at: '2026-11-24T09:00:00.000Z' }),
      row({ id: 3, net_hash: 'n1', created_at: '2026-11-24T10:00:00.000Z' }),
      row({ id: 10, net_hash: 'n1', created_at: '2026-11-23T10:00:00.000Z' }),
      row({
        id: 4,
        kind: 'move',
        venue_id: 'osm:node/2',
        lat: 38.878,
        lon: -6.97,
        created_at: '2026-11-24T08:00:00.000Z',
      }),
      row({
        id: 5,
        kind: 'add',
        venue_id: '',
        name: 'Bar Nuevo',
        venue_kind: 'bar',
        terrace: 1,
        lat: 38.878,
        lon: -6.97,
        created_at: '2026-11-24T11:00:00.000Z',
      }),
    ])
    expect(queue).toEqual([
      {
        ids: [3, 9, 10],
        kind: 'closed',
        venueId: 'osm:node/1',
        reporters: 2,
        last: '2026-11-24T10:00:00.000Z',
      },
      {
        ids: [5],
        kind: 'add',
        name: 'Bar Nuevo',
        venueKind: 'bar',
        terrace: true,
        lat: 38.878,
        lon: -6.97,
        reporters: 1,
        last: '2026-11-24T11:00:00.000Z',
      },
      {
        ids: [4],
        kind: 'move',
        venueId: 'osm:node/2',
        lat: 38.878,
        lon: -6.97,
        reporters: 1,
        last: '2026-11-24T08:00:00.000Z',
      },
    ])
  })

  it('reads terrace 0 as false and is empty for no rows', () => {
    const [entry] = reportQueue([
      row({
        kind: 'add',
        venue_id: '',
        name: 'Bar',
        venue_kind: 'pub',
        terrace: 0,
        lat: 1,
        lon: 2,
      }),
    ])
    expect(entry).toMatchObject({ kind: 'add', terrace: false })
    expect(reportQueue([])).toEqual([])
  })
})

describe('parseResolution', () => {
  it('accepts ids and a status', () => {
    expect(parseResolution({ ids: [3, 9], status: 'accepted' })).toEqual({
      ids: [3, 9],
      status: 'accepted',
    })
  })

  it.each([
    null,
    { ids: [], status: 'accepted' },
    { ids: [1.5], status: 'rejected' },
    { ids: ['3'], status: 'rejected' },
    { ids: [3], status: 'pending' },
  ])('refuses %j', (body) => {
    expect(parseResolution(body)).toBeNull()
  })
})
