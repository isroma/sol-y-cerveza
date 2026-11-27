import { describe, expect, it } from 'vitest'
import {
  acceptedSunResponseSchema,
  formatSunCorrectionsCsv,
  missingSunCorrections,
  parseSunCorrectionsCsv,
  toSunCorrection,
  type SunCorrectionRow,
} from './sunCorrectionsCsv.ts'

const HEADER = 'id,venue_id,leaf_off,azimuth,altitude,seen,kind'

const row = (fields: Partial<SunCorrectionRow>): SunCorrectionRow => ({
  id: 1,
  venueId: 'osm:node/123',
  leafOff: false,
  azimuth: 176.3,
  altitude: 27.1,
  seen: '2026-11-25T12:31:04.000Z',
  kind: 'sun',
  ...fields,
})

describe('sun_corrections.csv', () => {
  it('writes the contract’s format: sorted by id, 1 decimal, LF and a trailing newline', () => {
    const text = formatSunCorrectionsCsv([
      row({ id: 12 }),
      row({ id: 3, venueId: 'review:bar-x', leafOff: true, azimuth: 90 }),
    ])
    expect(text).toBe(
      [
        HEADER,
        '3,review:bar-x,1,90.0,27.1,2026-11-25T12:31:04.000Z,sun',
        '12,osm:node/123,0,176.3,27.1,2026-11-25T12:31:04.000Z,sun',
        '',
      ].join('\n'),
    )
    expect(formatSunCorrectionsCsv([])).toBe(`${HEADER}\n`)
  })

  it('reads back what it writes', () => {
    const rows = [row({ id: 2, leafOff: true }), row({ id: 7, altitude: 0 })]
    expect(parseSunCorrectionsCsv(formatSunCorrectionsCsv(rows))).toEqual(rows)
    expect(parseSunCorrectionsCsv(`${HEADER}\r\n`)).toEqual([])
    // Byte for byte: a header-only file, or one the formatter wrote, comes
    // back unchanged, so a sync with nothing to add never dirties the repo.
    for (const text of [
      `${HEADER}\n`,
      formatSunCorrectionsCsv([row({ id: 4, azimuth: 360 }), row({ id: 9 })]),
    ])
      expect(formatSunCorrectionsCsv(parseSunCorrectionsCsv(text))).toBe(text)
  })

  it('refuses a venue id the build’s reader refuses', () => {
    expect(() =>
      parseSunCorrectionsCsv(
        `${HEADER}\n1,osm:relation/1,0,1.0,2.0,2026-11-25T12:31:04.000Z\n`,
      ),
    ).toThrow(/:2:/)
  })

  it('refuses a wrong header, a bad row or an id twice', () => {
    expect(() => parseSunCorrectionsCsv('id,venue_id\n')).toThrow(/header/)
    const bad = (line: string) => () =>
      parseSunCorrectionsCsv(`${HEADER}\n${line}\n`)
    expect(
      bad('1,osm:node/1,2,176.3,27.1,2026-11-25T12:31:04.000Z,sun'),
    ).toThrow(/:2: leaf_off/)
    expect(bad('1,osm:node/1,0,,27.1,2026-11-25T12:31:04.000Z,sun')).toThrow(
      /numbers/,
    )
    expect(
      bad('x,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04.000Z,sun'),
    ).toThrow(/numbers/)
    expect(bad('1,osm:node/1,0,176.3,27.1,2026-11-25,sun')).toThrow(/:2:/)
    expect(bad('1,osm:node/1,0,176.3,27.1')).toThrow(/fields/)
    expect(
      bad('0,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04.000Z,sun'),
    ).toThrow(/:2:/)
    expect(
      bad(
        '1,osm:node/1,0,1.0,2.0,2026-11-25T12:31:04.000Z,sun\n1,osm:node/2,0,1.0,2.0,2026-11-25T12:31:04.000Z,sun',
      ),
    ).toThrow(/:3: id 1 is there twice/)
  })

  it('turns an accepted report into a row, degrees to 1 decimal', () => {
    expect(
      toSunCorrection({
        id: 12,
        venueId: 'osm:node/123',
        leafOff: true,
        azimuth: 176.34,
        altitude: 27.06,
        at: '2026-11-25T12:31:04.000Z',
        kind: 'sun',
      }),
    ).toEqual(row({ id: 12, leafOff: true }))
    expect(() =>
      toSunCorrection({
        id: 1,
        venueId: 'a,b',
        leafOff: false,
        azimuth: 1,
        altitude: 2,
        at: '2026-11-25T12:31:04.000Z',
        kind: 'sun',
      }),
    ).toThrow()
  })

  it('adds only the ids the file lacks, each once, and keeps the rows there', () => {
    const there = [row({ id: 1, altitude: 10 }), row({ id: 4 })]
    expect(
      missingSunCorrections(there, [
        row({ id: 1, altitude: 50 }),
        row({ id: 2 }),
        row({ id: 2, altitude: 3 }),
        row({ id: 4 }),
        row({ id: 9 }),
      ]).map((r) => r.id),
    ).toEqual([2, 9])
    expect(missingSunCorrections(there, there)).toEqual([])
  })
})

// Shade reports (#527, ADR-0014).
describe('sun_corrections.csv with shade', () => {
  it('writes and reads a shade row', () => {
    const rows = [row({ id: 4, kind: 'shade' })]
    expect(parseSunCorrectionsCsv(formatSunCorrectionsCsv(rows))).toEqual(rows)
  })

  it('reads a file from before shade reports as sun', () => {
    const text =
      'id,venue_id,leaf_off,azimuth,altitude,seen\n1,osm:node/123,0,176.3,27.1,2026-11-25T12:31:04.000Z\n'
    expect(parseSunCorrectionsCsv(text)).toEqual([row({})])
  })

  it('refuses a kind it does not know', () => {
    expect(() =>
      parseSunCorrectionsCsv(
        `${HEADER}\n1,osm:node/123,0,176.3,27.1,2026-11-25T12:31:04.000Z,cloud\n`,
      ),
    ).toThrow('kind must be sun or shade')
  })

  it('takes the kind from an accepted report, sun when the API sends none', () => {
    const report = {
      id: 9,
      venueId: 'osm:node/123',
      leafOff: false,
      azimuth: 176.34,
      altitude: 27.06,
      at: '2026-11-25T12:31:04.000Z',
    }
    expect(toSunCorrection({ ...report, kind: 'shade' }).kind).toBe('shade')
    const [parsed] = acceptedSunResponseSchema.parse({
      reports: [report],
    }).reports
    expect(parsed?.kind).toBe('sun')
  })
})
