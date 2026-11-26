import { describe, expect, it } from 'vitest'
import {
  formatSunCorrectionsCsv,
  missingSunCorrections,
  parseSunCorrectionsCsv,
  toSunCorrection,
  type SunCorrectionRow,
} from './sunCorrectionsCsv.ts'

const HEADER = 'id,venue_id,leaf_off,azimuth,altitude,seen'

const row = (fields: Partial<SunCorrectionRow>): SunCorrectionRow => ({
  id: 1,
  venueId: 'osm:node/123',
  leafOff: false,
  azimuth: 176.3,
  altitude: 27.1,
  seen: '2026-11-25T12:31:04.000Z',
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
        '3,review:bar-x,1,90.0,27.1,2026-11-25T12:31:04.000Z',
        '12,osm:node/123,0,176.3,27.1,2026-11-25T12:31:04.000Z',
        '',
      ].join('\n'),
    )
    expect(formatSunCorrectionsCsv([])).toBe(`${HEADER}\n`)
  })

  it('reads back what it writes', () => {
    const rows = [row({ id: 2, leafOff: true }), row({ id: 7, altitude: 0 })]
    expect(parseSunCorrectionsCsv(formatSunCorrectionsCsv(rows))).toEqual(rows)
    expect(parseSunCorrectionsCsv(`${HEADER}\r\n`)).toEqual([])
  })

  it('refuses a wrong header, a bad row or an id twice', () => {
    expect(() => parseSunCorrectionsCsv('id,venue_id\n')).toThrow(/header/)
    const bad = (line: string) => () =>
      parseSunCorrectionsCsv(`${HEADER}\n${line}\n`)
    expect(bad('1,osm:node/1,2,176.3,27.1,2026-11-25T12:31:04.000Z')).toThrow(
      /:2: leaf_off/,
    )
    expect(bad('1,osm:node/1,0,,27.1,2026-11-25T12:31:04.000Z')).toThrow(
      /numbers/,
    )
    expect(bad('x,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04.000Z')).toThrow(
      /numbers/,
    )
    expect(bad('1,osm:node/1,0,176.3,27.1,2026-11-25')).toThrow(/:2:/)
    expect(bad('1,osm:node/1,0,176.3,27.1')).toThrow(/fields/)
    expect(bad('0,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04.000Z')).toThrow(
      /:2:/,
    )
    expect(
      bad(
        '1,a,0,1.0,2.0,2026-11-25T12:31:04.000Z\n1,b,0,1.0,2.0,2026-11-25T12:31:04.000Z',
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
