import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { madridDate } from './logic.ts'
import {
  acceptedSun,
  binDistance,
  capTenths,
  floorTenths,
  horizonBin,
  isLeafOff,
  LEAF_OFF,
  LEAF_OFF_SEEN,
  MIN_SUN_ALTITUDE,
  sighting,
  SUN_THRESHOLD,
  SUN_WINDOW_DAYS,
  sunCorrections,
  sunQueue,
  type RejectionRow,
  type SunRow,
} from './sun.ts'

// Sun reports (#364, ADR-0012).

const BADAJOZ = { lat: 38.878, lon: -6.97 }
const NOW = Date.parse('2026-11-25T12:00:00.000Z')
const TODAY = '2026-11-25T11:00:00.000Z'

let nextId = 1
const row = (fields: Partial<SunRow>): SunRow => ({
  id: nextId++,
  venue_id: 'osm:node/1',
  azimuth: 180,
  altitude: 30,
  leaf_off: 0,
  net_hash: 'n1',
  created_at: TODAY,
  status: 'pending',
  ...fields,
})

/** One pending report per network n1, n2, … at the given altitudes. */
const networks = (altitudes: number[], fields: Partial<SunRow> = {}) =>
  altitudes.map((altitude, i) =>
    row({ net_hash: `n${i + 1}`, altitude, ...fields }),
  )

const rejection = (fields: Partial<RejectionRow>): RejectionRow => ({
  venue_id: 'osm:node/1',
  leaf_off: 0,
  bin: 180,
  rejected_at: TODAY,
  ...fields,
})

/** The runs as [from, to, altitude, confirmed]. */
const runs = (rows: SunRow[], rejections: RejectionRow[] = []) =>
  sunCorrections(rows, rejections, NOW).map((c) => [
    c.from,
    c.to,
    c.altitude,
    c.confirmed,
  ])

describe('sighting', () => {
  it('computes the sun at the venue, with the season by Madrid date', () => {
    const noon = sighting(BADAJOZ, new Date('2026-11-25T12:30:00Z'))
    expect(noon.ok).toBe(true)
    if (!noon.ok) return
    expect(noon.value.azimuth).toBeCloseTo(184.1, 1)
    expect(noon.value.altitude).toBeCloseTo(30.2, 1)
    expect(noon.value.bin).toBe(184)
    expect(noon.value.leafOff).toBe(false)
    const winter = sighting(BADAJOZ, new Date('2026-12-01T12:30:00Z'))
    expect(winter.ok && winter.value.leafOff).toBe(true)
  })

  it(`refuses the sun under ${MIN_SUN_ALTITUDE}°`, () => {
    expect(sighting(BADAJOZ, new Date('2026-11-25T00:00:00Z'))).toEqual({
      ok: false,
      error: 'sun is down',
    })
    // Sunrise on 25 November: 1.86° at 07:35 UTC, 2.02° at 07:36.
    expect(sighting(BADAJOZ, new Date('2026-11-25T07:35:00Z')).ok).toBe(false)
    expect(sighting(BADAJOZ, new Date('2026-11-25T07:36:00Z')).ok).toBe(true)
  })

  it('refuses a venue without a position', () => {
    const refused = { ok: false, error: 'venue has no position' }
    const noon = new Date('2026-11-25T12:30:00Z')
    expect(sighting({ lat: NaN, lon: NaN }, noon)).toEqual(refused)
    expect(sighting(undefined, noon)).toEqual(refused)
  })
})

describe('the season', () => {
  it('is leaf-off from 1 December to 15 April without seen dates, as in the app', async () => {
    expect(isLeafOff('2026-11-30')).toBe(false)
    expect(isLeafOff('2026-12-01')).toBe(true)
    expect(isLeafOff('2027-04-15')).toBe(true)
    expect(isLeafOff('2027-04-16')).toBe(false)
    expect(isLeafOff('nonsense')).toBe(false)
    // 23:30 UTC on 30 November is already 1 December in Madrid.
    expect(isLeafOff(madridDate(new Date('2026-11-30T23:30:00Z')))).toBe(true)
    const app = await readFile(
      join(import.meta.dirname, '../../web/src/sun/leafOff.ts'),
      'utf8',
    )
    expect(app).toContain(
      `LEAF_OFF = { from: '${LEAF_OFF.from}', until: '${LEAF_OFF.until}' }`,
    )
    expect(app).toContain(
      `LEAF_OFF_SEEN = { from: '${LEAF_OFF_SEEN.from}', until: '${LEAF_OFF_SEEN.until}' }`,
    )
  })

  it('follows the dates Sentinel-2 saw, inside their windows', () => {
    const seen = { leaf_off_from: '2026-11-23', leaf_off_until: '2027-04-08' }
    expect(isLeafOff('2026-11-22', seen)).toBe(false)
    expect(isLeafOff('2026-11-23', seen)).toBe(true)
    expect(isLeafOff('2027-04-07', seen)).toBe(true)
    expect(isLeafOff('2027-04-08', seen)).toBe(false)
    expect(isLeafOff('2027-11-25', seen)).toBe(false)
    expect(isLeafOff('2026-09-20', { leaf_off_from: '2026-09-15' })).toBe(false)
  })

  it('gives a sighting the season of the published dates', () => {
    const lateNovember = new Date('2026-11-25T11:00:00Z')
    const at = { lat: 38.8794, lon: -6.9707 }
    const plain = sighting(at, lateNovember)
    const seen = sighting(at, lateNovember, { leaf_off_from: '2026-11-23' })
    expect(plain.ok && plain.value.leafOff).toBe(false)
    expect(seen.ok && seen.value.leafOff).toBe(true)
  })
})

describe('bins and caps', () => {
  it('bins azimuths as the app does, and measures across north', () => {
    expect(horizonBin(359.6)).toBe(0)
    expect(horizonBin(184.49)).toBe(184)
    expect(binDistance(359, 0)).toBe(1)
    expect(binDistance(3, 355)).toBe(8)
    expect(binDistance(180, 180)).toBe(0)
  })

  it('takes the 2° margin off and floors to tenths, never below 0', () => {
    expect(capTenths(27.1)).toBe(251)
    expect(capTenths(30.09)).toBe(280)
    expect(capTenths(2)).toBe(0)
    expect(capTenths(1.5)).toBe(0)
  })
})

describe('sunCorrections', () => {
  it(`needs ${SUN_THRESHOLD} distinct networks, not voters`, () => {
    expect(runs(networks([30, 30]))).toEqual([])
    // Three voters on one network count once.
    expect(
      runs([row({ id: 1 }), row({ id: 2 }), row({ id: 3, altitude: 35 })]),
    ).toEqual([])
    expect(runs(networks([30, 30, 30]))).toEqual([[175, 185, 280, false]])
  })

  it('caps at the 3rd-lowest altitude, each network at its lowest', () => {
    expect(runs(networks([25, 40, 30]))).toEqual([[175, 185, 380, false]])
    // n1 also saw sun at 50°: it counts at 20°.
    expect(
      runs([...networks([20, 30, 35]), row({ net_hash: 'n1', altitude: 50 })]),
    ).toEqual([[175, 185, 330, false]])
  })

  it('counts a report only within 5° of its azimuth, and merges equal bins into runs', () => {
    // Bins 175–185, 180–190 and 185–195 meet only at 185.
    expect(
      runs([
        row({ net_hash: 'n1', azimuth: 180 }),
        row({ net_hash: 'n2', azimuth: 185 }),
        row({ net_hash: 'n3', azimuth: 190 }),
      ]),
    ).toEqual([[185, 185, 280, false]])
    expect(
      runs([
        row({ net_hash: 'n1', azimuth: 180 }),
        row({ net_hash: 'n2', azimuth: 190 }),
        row({ net_hash: 'n3', azimuth: 200 }),
      ]),
    ).toEqual([])
    // One lower network doesn't move the 3rd-lowest.
    expect(
      runs([
        ...networks([30, 30, 30]),
        row({ net_hash: 'n4', azimuth: 183, altitude: 20 }),
      ]),
    ).toEqual([[175, 185, 280, false]])
    // Three lower networks further east: the cap steps down where they reach.
    expect(
      runs([
        ...networks([30, 30, 30]),
        ...['n4', 'n5', 'n6'].map((net_hash) =>
          row({ net_hash, azimuth: 183, altitude: 20 }),
        ),
      ]),
    ).toEqual([
      [175, 177, 280, false],
      [178, 188, 180, false],
    ])
  })

  it('keeps a run across north as one, from > to', () => {
    const corrections = sunCorrections(
      [
        row({ net_hash: 'n1', azimuth: 359.6 }),
        row({ net_hash: 'n2', azimuth: 0.2 }),
        row({ net_hash: 'n3', azimuth: 358 }),
      ],
      [],
      NOW,
    )
    expect(corrections).toEqual([
      {
        venueId: 'osm:node/1',
        leafOff: false,
        from: 355,
        to: 3,
        altitude: 280,
        confirmed: false,
        reporters: 3,
        last: TODAY,
      },
    ])
  })

  it('keeps the seasons apart', () => {
    expect(
      runs([...networks([30, 30]), row({ net_hash: 'n3', leaf_off: 1 })]),
    ).toEqual([])
    expect(
      sunCorrections(networks([30, 30, 30], { leaf_off: 1 }), [], NOW).map(
        (c) => c.leafOff,
      ),
    ).toEqual([true])
  })

  it(`forgets reports older than ${SUN_WINDOW_DAYS} days`, () => {
    const old = new Date(NOW - (SUN_WINDOW_DAYS + 1) * 86400_000).toISOString()
    expect(
      runs([...networks([30, 30]), row({ net_hash: 'n3', created_at: old })]),
    ).toEqual([])
    const recent = new Date(NOW - 300 * 86400_000).toISOString()
    expect(
      runs([
        ...networks([30, 30]),
        row({ net_hash: 'n3', created_at: recent }),
      ]),
    ).toEqual([[175, 185, 280, false]])
  })

  it('leaves out rejected reports and the slices the owner rejected', () => {
    expect(
      runs([
        ...networks([30, 30]),
        row({ net_hash: 'n3', status: 'rejected' }),
      ]),
    ).toEqual([])
    const three = networks([30, 30, 30])
    expect(runs(three, [rejection({ bin: 180 })])).toEqual([])
    // A slice at 190 blocks 185–195 only.
    expect(runs(three, [rejection({ bin: 190 })])).toEqual([
      [175, 184, 280, false],
    ])
    // Another venue, the other season or a rejection past the window block nothing.
    const old = new Date(NOW - (SUN_WINDOW_DAYS + 1) * 86400_000).toISOString()
    for (const other of [
      rejection({ venue_id: 'osm:node/2' }),
      rejection({ leaf_off: 1 }),
      rejection({ rejected_at: old }),
    ])
      expect(runs(three, [other])).toEqual([[175, 185, 280, false]])
  })

  it('confirms with one accepted report, at its altitude, whatever was rejected', () => {
    expect(
      runs([row({ status: 'accepted', altitude: 25 })], [rejection({})]),
    ).toEqual([[175, 185, 230, true]])
    // Accepted and consensus side by side: consensus first.
    expect(
      runs([
        ...networks([30, 30, 30]),
        row({ net_hash: 'n4', status: 'accepted', altitude: 40, azimuth: 200 }),
      ]),
    ).toEqual([
      [175, 185, 280, false],
      [195, 205, 380, true],
    ])
    // Two accepted reports in one bin: the lower one.
    expect(
      runs([
        row({ status: 'accepted', altitude: 35 }),
        row({ status: 'accepted', altitude: 25, azimuth: 182 }),
      ]),
    ).toEqual([
      [175, 176, 330, true],
      [177, 187, 230, true],
    ])
  })

  it('counts the networks behind a run and its newest report', () => {
    const [run] = sunCorrections(
      [
        ...networks([30, 30, 30]),
        row({
          net_hash: 'n4',
          altitude: 50,
          created_at: '2026-11-25T11:30:00.000Z',
        }),
      ],
      [],
      NOW,
    )
    expect(run?.reporters).toBe(4)
    expect(run?.last).toBe('2026-11-25T11:30:00.000Z')
  })

  it('sorts by venue, season, confirmed and bin, whatever the input order', () => {
    const rows = [
      ...networks([30, 30, 30], { venue_id: 'osm:node/2', azimuth: 90 }),
      ...networks([30, 30, 30], { venue_id: 'osm:node/2', azimuth: 270 }),
      ...networks([30, 30, 30], { venue_id: 'osm:node/1', leaf_off: 1 }),
      ...networks([30, 30, 30], { venue_id: 'osm:node/1' }),
      row({ venue_id: 'osm:node/1', status: 'accepted', azimuth: 10 }),
    ]
    const key = (c: {
      venueId: string
      leafOff: boolean
      confirmed: boolean
      from: number
    }) => `${c.venueId} ${c.leafOff} ${c.confirmed} ${c.from}`
    const forward = sunCorrections(rows, [], NOW)
    expect(forward.map(key)).toEqual([
      'osm:node/1 false false 175',
      'osm:node/1 false true 5',
      'osm:node/1 true false 175',
      'osm:node/2 false false 85',
      'osm:node/2 false false 265',
    ])
    expect(sunCorrections([...rows].reverse(), [], NOW)).toEqual(forward)
  })
})

describe('sunQueue', () => {
  it('groups pending reports per venue and season, most reporters first', () => {
    const queue = sunQueue(
      [
        row({ id: 9, net_hash: 'n2', azimuth: 176.34, altitude: 27.06 }),
        row({ id: 4, net_hash: 'n1' }),
        row({ id: 12, net_hash: 'n3', created_at: '2026-11-25T11:30:00.000Z' }),
        row({
          id: 5,
          venue_id: 'osm:node/2',
          created_at: '2026-11-25T11:45:00.000Z',
        }),
        row({ id: 6, leaf_off: 1 }),
        // Accepted reports are not in the queue.
        row({ id: 7, venue_id: 'osm:node/3', status: 'accepted' }),
      ],
      [],
      NOW,
    )
    expect(
      queue.map((e) => [e.venueId, e.leafOff, e.ids, e.reporters]),
    ).toEqual([
      ['osm:node/1', false, [4, 9, 12], 3],
      ['osm:node/2', false, [5], 1],
      ['osm:node/1', true, [6], 1],
    ])
    expect(queue[0]).toMatchObject({
      sightings: [
        { id: 4, azimuth: 180, altitude: 30, at: TODAY },
        { id: 9, azimuth: 176.3, altitude: 27.1, at: TODAY },
        { id: 12, azimuth: 180, altitude: 30, at: '2026-11-25T11:30:00.000Z' },
      ],
      shown: true,
      last: '2026-11-25T11:30:00.000Z',
    })
    expect(queue[1]?.shown).toBe(false)
  })

  it('shows a report as shown only when a served consensus counts it', () => {
    const shown = (rows: SunRow[], rejections: RejectionRow[] = []) =>
      sunQueue(rows, rejections, NOW).map((e) => e.shown)
    // n4 at 200° is 15° from the others: listed, but behind no consensus.
    const three = networks([30, 30, 30])
    expect(
      shown([
        ...three,
        row({ net_hash: 'n4', azimuth: 200, venue_id: 'osm:node/1' }),
      ]),
    ).toEqual([true])
    expect(shown([row({ net_hash: 'n4', azimuth: 200 })])).toEqual([false])
    expect(shown(three, [rejection({})])).toEqual([false])
    // A pending report past the window is still listed, but counts for nothing.
    const old = new Date(NOW - (SUN_WINDOW_DAYS + 1) * 86400_000).toISOString()
    expect(
      sunQueue(
        [...networks([30, 30]), row({ net_hash: 'n3', created_at: old })],
        [],
        NOW,
      ).map((e) => [e.ids.length, e.shown]),
    ).toEqual([[3, false]])
  })
})

describe('acceptedSun', () => {
  it('lists the accepted reports in the window by id, degrees to 1 decimal', () => {
    const old = new Date(NOW - (SUN_WINDOW_DAYS + 1) * 86400_000).toISOString()
    const rows = [
      row({ id: 9, status: 'accepted', azimuth: 176.34, altitude: 27.06 }),
      row({ id: 3, status: 'accepted', leaf_off: 1, venue_id: 'osm:way/2' }),
      row({ id: 4, status: 'pending' }),
      row({ id: 5, status: 'rejected' }),
      row({ id: 6, status: 'accepted', created_at: old }),
    ]
    expect(acceptedSun(rows, NOW)).toEqual([
      {
        id: 3,
        venueId: 'osm:way/2',
        leafOff: true,
        kind: 'sun',
        azimuth: 180,
        altitude: 30,
        at: TODAY,
      },
      {
        id: 9,
        venueId: 'osm:node/1',
        leafOff: false,
        kind: 'sun',
        azimuth: 176.3,
        altitude: 27.1,
        at: TODAY,
      },
    ])
  })
})

// Shade reports (#527, ADR-0014).
describe('shade floors', () => {
  const shade = (fields: Partial<SunRow> = {}) =>
    row({ kind: 'shade', ...fields })
  const floors = (rows: SunRow[], rejections: RejectionRow[] = []) =>
    sunCorrections(rows, rejections, NOW, 'shade').map((c) => [
      c.from,
      c.to,
      c.altitude,
      c.confirmed,
    ])

  it('rounds up to tenths, with no margin, at most 90°', () => {
    expect(floorTenths(27.1)).toBe(271)
    expect(floorTenths(27.11)).toBe(272)
    expect(floorTenths(95)).toBe(900)
  })

  it('floors 2° either side at the 3rd-highest altitude, each network at its highest', () => {
    const rows = [
      shade({ net_hash: 'n1', altitude: 25 }),
      shade({ net_hash: 'n2', altitude: 40 }),
      shade({ net_hash: 'n3', altitude: 30 }),
      shade({ net_hash: 'n1', altitude: 20 }),
    ]
    expect(floors(rows)).toEqual([[178, 182, 250, false]])
  })

  it('keeps sun and shade apart, in the answer and in rejections', () => {
    const rows = [
      ...networks([30, 30, 30]),
      ...networks([30, 30, 30], { kind: 'shade' }),
    ]
    expect(runs(rows)).toEqual([[175, 185, 280, false]])
    expect(floors(rows)).toEqual([[178, 182, 300, false]])
    const shadeRejected = rejection({ kind: 'shade' })
    expect(runs(rows, [shadeRejected])).toEqual([[175, 185, 280, false]])
    expect(floors(rows, [shadeRejected])).toEqual([])
  })

  it('confirms with one accepted shade report, at its altitude', () => {
    expect(floors([shade({ status: 'accepted', altitude: 33.3 })])).toEqual([
      [178, 182, 333, true],
    ])
  })

  it('queues and lists shade with its kind', () => {
    const rows = [shade({ status: 'accepted' }), shade({ net_hash: 'n9' })]
    expect(acceptedSun(rows, NOW).map((r) => r.kind)).toEqual(['shade'])
    expect(sunQueue(rows, [], NOW).map((e) => e.kind)).toEqual(['shade'])
  })
})
