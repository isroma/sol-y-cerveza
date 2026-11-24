import { describe, expect, it } from 'vitest'
import {
  byReporters,
  describeReport,
  isStale,
  reportChange,
  reportsResponseSchema,
} from './reports.ts'

const body = {
  reports: [
    {
      ids: [4],
      kind: 'move',
      venueId: 'osm:node/2',
      lat: 38.878,
      lon: -6.97,
      reporters: 1,
      last: '2026-11-24T09:00:00.000Z',
    },
    {
      ids: [3, 9],
      kind: 'closed',
      venueId: 'osm:node/1',
      reporters: 3,
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
      last: '2026-11-24T08:00:00.000Z',
    },
  ],
}

const [move, closed, add] = reportsResponseSchema.parse(body).reports
const pepe = { name: 'Bar Pepe', at: { lat: 38.878, lon: -6.9705 } }

describe('reportsResponseSchema', () => {
  it('parses each kind', () => {
    expect([move?.kind, closed?.kind, add?.kind]).toEqual([
      'move',
      'closed',
      'add',
    ])
  })

  it('rejects a move without a position and an unknown venue kind', () => {
    const { lat: _lat, ...noLat } = body.reports[0] ?? {}
    expect(reportSchemaFails({ reports: [noLat] })).toBe(true)
    expect(
      reportSchemaFails({
        reports: [{ ...body.reports[2], venueKind: 'disco' }],
      }),
    ).toBe(true)
  })
})

function reportSchemaFails(value: unknown): boolean {
  return !reportsResponseSchema.safeParse(value).success
}

describe('byReporters', () => {
  it('puts most reporters first and keeps ties in order', () => {
    const sorted = byReporters(reportsResponseSchema.parse(body).reports)
    expect(sorted.map((r) => r.ids[0])).toEqual([3, 4, 5])
  })
})

describe('describeReport', () => {
  it('says what each report is in one line', () => {
    if (
      move?.kind !== 'move' ||
      closed?.kind !== 'closed' ||
      add?.kind !== 'add'
    )
      throw new Error('fixture')
    expect(describeReport(closed, pepe)).toBe('Closed · Bar Pepe · 3 people')
    expect(describeReport(move, pepe)).toBe('Moved · Bar Pepe · 43 m')
    expect(describeReport(add, undefined)).toBe(
      'New · Bar Nuevo (bar, terrace)',
    )
    expect(describeReport({ ...add, terrace: false }, undefined)).toBe(
      'New · Bar Nuevo (bar)',
    )
    expect(describeReport({ ...closed, reporters: 1 }, pepe)).toBe(
      'Closed · Bar Pepe · 1 person',
    )
  })

  it('marks reports on venues gone from the data as stale', () => {
    if (!move || !closed || !add) throw new Error('fixture')
    expect(isStale(closed, undefined)).toBe(true)
    expect(isStale(move, pepe)).toBe(false)
    expect(isStale(add, undefined)).toBe(false)
    expect(describeReport(closed, undefined)).toContain('stale')
  })
})

describe('terrace reports (#210)', () => {
  const [yes, no, pin] = reportsResponseSchema.parse({
    reports: [
      {
        ids: [6, 7],
        kind: 'terrace',
        venueId: 'osm:node/1',
        terrace: true,
        reporters: 2,
        last: '2026-11-24T10:00:00.000Z',
      },
      {
        ids: [8],
        kind: 'terrace',
        venueId: 'osm:node/1',
        terrace: false,
        reporters: 1,
        last: '2026-11-24T09:00:00.000Z',
      },
      {
        ids: [9],
        kind: 'pin',
        venueId: 'osm:node/1',
        lat: 38.8781,
        lon: -6.9705,
        reporters: 1,
        last: '2026-11-24T08:00:00.000Z',
      },
    ],
  }).reports

  it('describes answers with their counts, and a pin with its distance', () => {
    if (!yes || !no || !pin) throw new Error('fixture')
    expect(describeReport(yes, pepe)).toBe('Terrace: yes · Bar Pepe · 2 people')
    expect(describeReport(no, pepe)).toBe('Terrace: no · Bar Pepe · 1 person')
    expect(describeReport(pin, pepe)).toBe(
      'Terrace here · Bar Pepe · 11 m from the venue',
    )
    expect(isStale(pin, undefined)).toBe(true)
    expect(describeReport(yes, undefined)).toContain('stale')
  })

  it('turns each report into the review change the admin would make', () => {
    if (
      yes?.kind !== 'terrace' ||
      no?.kind !== 'terrace' ||
      pin?.kind !== 'pin' ||
      move?.kind !== 'move' ||
      closed?.kind !== 'closed'
    )
      throw new Error('fixture')
    expect(reportChange(yes)).toEqual({ kind: 'status', status: 'terrace' })
    expect(reportChange(no)).toEqual({ kind: 'status', status: 'no_terrace' })
    expect(reportChange(pin)).toEqual({
      kind: 'terrace',
      at: { lat: 38.8781, lon: -6.9705 },
    })
    expect(reportChange(move)).toEqual({
      kind: 'venue',
      at: { lat: 38.878, lon: -6.97 },
    })
    expect(reportChange(closed)).toEqual({
      kind: 'status',
      status: 'not_venue',
    })
    // The app's badge sits on the terrace, so that is what a move moves.
    expect(reportChange(move, true)).toEqual({
      kind: 'terrace',
      at: { lat: 38.878, lon: -6.97 },
    })
  })
})
