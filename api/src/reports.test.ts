import { describe, expect, it } from 'vitest'
import { turnstilePassed } from './logic.ts'
import {
  capKey,
  cleanName,
  distanceM,
  groupReports,
  MAX_MOVE_M,
  MAX_PIN_M,
  NEW_VENUE_KEY,
  parseReport,
  parseResolution,
  REPORT_ACTION,
  reportColumns,
  venueProblem,
  type ReportRow,
} from './reports.ts'

const at = { lat: 38.878, lon: -6.97 }
const token = 'turnstile-token'

describe('parseReport', () => {
  it('accepts each kind', () => {
    expect(parseReport({ kind: 'closed', venueId: 'osm:node/1', token })).toEqual({
      ok: true,
      value: { kind: 'closed', venueId: 'osm:node/1' },
      token,
    })
    expect(parseReport({ kind: 'move', venueId: 'osm:node/1', ...at, token }).ok).toBe(true)
    expect(parseReport({ kind: 'pin', venueId: 'junta:0123456789ab', ...at, token }).ok).toBe(true)
    expect(parseReport({ kind: 'terrace', venueId: 'review:bar-pepe', terrace: false, token })).toEqual({
      ok: true,
      value: { kind: 'terrace', venueId: 'review:bar-pepe', terrace: false },
      token,
    })
    expect(
      parseReport({ kind: 'add', name: 'Bar Nuevo', venueKind: 'bar', terrace: true, ...at, token }),
    ).toEqual({
      ok: true,
      value: { kind: 'add', name: 'Bar Nuevo', venueKind: 'bar', terrace: true, ...at },
      token,
    })
  })

  it('rounds positions to 6 decimals', () => {
    const parsed = parseReport({
      kind: 'move',
      venueId: 'osm:node/1',
      lat: 38.87812345678,
      lon: -6.97000049,
      token,
    })
    expect(parsed.ok && parsed.value.kind === 'move' && [parsed.value.lat, parsed.value.lon]).toEqual([
      38.878123, -6.97,
    ])
  })

  it('cleans the name of a new venue', () => {
    const parsed = parseReport({
      kind: 'add',
      name: '  Bar "El Patio",\n de Pepe ',
      venueKind: 'cafe',
      terrace: false,
      ...at,
      token,
    })
    expect(parsed.ok && parsed.value.kind === 'add' && parsed.value.name).toBe('Bar El Patio de Pepe')
  })

  it.each([
    [{ kind: 'rename', venueId: 'osm:node/1', token }, 'kind'],
    [{ kind: 'closed', venueId: 'google:1', token }, 'venueId'],
    [{ kind: 'closed', token }, 'venueId'],
    [{ kind: 'terrace', venueId: 'osm:node/1', terrace: 'yes', token }, 'terrace'],
    [{ kind: 'move', venueId: 'osm:node/1', token }, 'position'],
    [{ kind: 'move', venueId: 'osm:node/1', lat: 40.4, lon: -3.7, token }, 'position'],
    [{ kind: 'pin', venueId: 'osm:node/1', lat: Number.NaN, lon: -6.97, token }, 'position'],
    [{ kind: 'pin', venueId: 'osm:node/1', lat: '38.87', lon: -6.97, token }, 'position'],
    [{ kind: 'add', name: 'B', venueKind: 'bar', terrace: true, ...at, token }, 'name'],
    [{ kind: 'add', name: 'x'.repeat(61), venueKind: 'bar', terrace: true, ...at, token }, 'name'],
    [{ kind: 'add', name: 'www.spam.example', venueKind: 'bar', terrace: true, ...at, token }, 'name'],
    [{ kind: 'add', name: 'Visit http://x', venueKind: 'bar', terrace: true, ...at, token }, 'name'],
    [{ kind: 'add', name: 'mail me@x', venueKind: 'bar', terrace: true, ...at, token }, 'name'],
    [{ kind: 'add', name: '12345', venueKind: 'bar', terrace: true, ...at, token }, 'name'],
    [{ kind: 'add', name: 'Bar <b>', venueKind: 'bar', terrace: true, ...at, token }, 'name'],
    [{ kind: 'add', name: 'Bar Nuevo', venueKind: 'disco', terrace: true, ...at, token }, 'venueKind'],
    [{ kind: 'add', name: 'Bar Nuevo', venueKind: 'bar', ...at, token }, 'terrace'],
    [{ kind: 'add', name: 'Bar Nuevo', venueKind: 'bar', terrace: true, token }, 'position'],
    [{ kind: 'closed', venueId: 'osm:node/1', token: '' }, 'token'],
    ['nope', 'body'],
  ])('rejects %j (%s)', (body, error) => {
    expect(parseReport(body)).toEqual({ ok: false, error })
  })

  it('keeps accents and the punctuation of real names', () => {
    for (const name of ["Mesón O'Donnell", 'Café & Té', 'La Bodeguita nº 2', 'Kiosco (Paseo)'])
      expect(parseReport({ kind: 'add', name, venueKind: 'bar', terrace: false, ...at, token }).ok).toBe(true)
  })
})

describe('venueProblem', () => {
  const venue = { lat: 38.878, lon: -6.97 }
  const north = (m: number) => ({ lat: venue.lat + m / 111_195, lon: venue.lon })

  it('needs a published venue for venue reports, not for new ones', () => {
    expect(venueProblem({ kind: 'closed', venueId: 'osm:node/1' }, null)).toBe('unknown venue')
    expect(venueProblem({ kind: 'closed', venueId: 'osm:node/1' }, venue)).toBeNull()
    expect(
      venueProblem({ kind: 'add', name: 'Bar', venueKind: 'bar', terrace: true, ...venue }, null),
    ).toBeNull()
  })

  it('keeps moves and terrace pins near the venue', () => {
    expect(venueProblem({ kind: 'move', venueId: 'osm:node/1', ...north(MAX_MOVE_M - 5) }, venue)).toBeNull()
    expect(venueProblem({ kind: 'move', venueId: 'osm:node/1', ...north(MAX_MOVE_M + 5) }, venue)).toMatch(
      /more than 500 m/,
    )
    expect(venueProblem({ kind: 'pin', venueId: 'osm:node/1', ...north(MAX_PIN_M - 5) }, venue)).toBeNull()
    expect(venueProblem({ kind: 'pin', venueId: 'osm:node/1', ...north(MAX_PIN_M + 5) }, venue)).toMatch(
      /more than 150 m/,
    )
  })

  it('measures metres', () => {
    expect(distanceM(venue, north(100))).toBeCloseTo(100, 0)
  })
})

describe('storage', () => {
  it('counts new venues against one shared cap key', () => {
    expect(capKey({ kind: 'add', name: 'Bar', venueKind: 'bar', terrace: true, ...at })).toBe(NEW_VENUE_KEY)
    expect(capKey({ kind: 'closed', venueId: 'osm:node/1' })).toBe('osm:node/1')
  })

  it('fills only the columns a kind uses', () => {
    expect(reportColumns({ kind: 'terrace', venueId: 'osm:node/1', terrace: true })).toEqual({
      venueId: 'osm:node/1',
      lat: null,
      lon: null,
      name: null,
      venueKind: null,
      terrace: 1,
    })
    expect(reportColumns({ kind: 'add', name: 'Bar', venueKind: 'pub', terrace: false, ...at })).toEqual({
      venueId: '',
      ...at,
      name: 'Bar',
      venueKind: 'pub',
      terrace: 0,
    })
  })
})

function row(id: number, fields: Partial<ReportRow>): ReportRow {
  return {
    id,
    kind: 'closed',
    venue_id: 'osm:node/1',
    lat: null,
    lon: null,
    name: null,
    venue_kind: null,
    terrace: null,
    net_hash: `net${id}`,
    created_at: `2026-11-24T10:0${id}:00.000Z`,
    ...fields,
  }
}

describe('groupReports', () => {
  it('groups closed per venue and counts distinct networks', () => {
    const groups = groupReports([
      row(1, {}),
      row(2, { net_hash: 'net1' }),
      row(3, {}),
      row(4, { venue_id: 'osm:node/2' }),
    ])
    expect(groups).toEqual([
      { ids: [1, 2, 3], reporters: 2, last: '2026-11-24T10:03:00.000Z', kind: 'closed', venueId: 'osm:node/1' },
      { ids: [4], reporters: 1, last: '2026-11-24T10:04:00.000Z', kind: 'closed', venueId: 'osm:node/2' },
    ])
  })

  it('keeps the yes and no answers apart, so both counts show', () => {
    const groups = groupReports([
      row(1, { kind: 'terrace', terrace: 1 }),
      row(2, { kind: 'terrace', terrace: 1 }),
      row(3, { kind: 'terrace', terrace: 0 }),
    ])
    expect(groups.map((g) => g.kind === 'terrace' && [g.terrace, g.reporters])).toEqual([
      [true, 2],
      [false, 1],
    ])
  })

  it('lists moves, pins and new venues one per row, most recent first among equals', () => {
    const groups = groupReports([
      row(1, { kind: 'move', ...at }),
      row(2, { kind: 'pin', ...at }),
      row(3, { kind: 'add', venue_id: '', name: 'Bar Nuevo', venue_kind: 'bar', terrace: 1, ...at }),
      row(4, { kind: 'move', ...at }),
    ])
    expect(groups.map((g) => [g.kind, g.ids])).toEqual([
      ['move', [4]],
      ['add', [3]],
      ['pin', [2]],
      ['move', [1]],
    ])
    expect(groups[1]).toMatchObject({ name: 'Bar Nuevo', venueKind: 'bar', terrace: true, ...at })
  })

  it('skips rows it cannot read', () => {
    expect(groupReports([row(1, { kind: 'move' }), row(2, { kind: 'other' })])).toEqual([])
  })
})

describe('parseResolution', () => {
  it('takes ids and a status', () => {
    expect(parseResolution({ ids: [3, 9], status: 'accepted' })).toEqual({ ids: [3, 9], status: 'accepted' })
  })

  it.each([
    { ids: [], status: 'accepted' },
    { ids: [1.5], status: 'accepted' },
    { ids: ['1'], status: 'rejected' },
    { ids: [1], status: 'pending' },
    { ids: Array.from({ length: 101 }, (_, i) => i + 1), status: 'rejected' },
    null,
  ])('rejects %j', (body) => {
    expect(parseResolution(body)).toBeNull()
  })
})

describe('Turnstile action', () => {
  const origins = 'https://isroma.github.io'
  it('needs the report action for reports and refuses a price token', () => {
    const report = { success: true, hostname: 'isroma.github.io', action: REPORT_ACTION }
    expect(turnstilePassed(report, origins, false, REPORT_ACTION)).toBe(true)
    expect(turnstilePassed({ ...report, action: 'suggest' }, origins, false, REPORT_ACTION)).toBe(false)
    expect(turnstilePassed(report, origins, false)).toBe(false)
  })

  it('cleans names the same way the admin does', () => {
    expect(cleanName(' a,\tb  "c" ')).toBe('a b c')
  })
})
