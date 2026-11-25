import { describe, expect, it } from 'vitest'
import {
  horizonFromRuns,
  packDegrees,
  paseoSanFrancisco,
  withoutHorizon,
} from '../test/fixtures.ts'
import {
  describeSunReport,
  modelAt,
  sightingRows,
  sunResponseSchema,
} from './sunReports.ts'

const body = {
  reports: [
    {
      ids: [4, 9],
      venueId: paseoSanFrancisco.id,
      leafOff: false,
      sightings: [
        {
          id: 9,
          azimuth: 181.6,
          altitude: 26.4,
          at: '2026-07-02T13:05:00.000Z',
        },
        {
          id: 4,
          azimuth: 176.3,
          altitude: 27.1,
          at: '2026-06-30T12:31:04.000Z',
        },
      ],
      reporters: 2,
      shown: false,
      last: '2026-07-02T13:05:00.000Z',
    },
  ],
}

const [report] = sunResponseSchema.parse(body).reports
if (!report) throw new Error('no report parsed')

describe('sunResponseSchema', () => {
  it('parses the admin queue', () => {
    expect(report.ids).toEqual([4, 9])
    expect(report.sightings).toHaveLength(2)
  })

  it('rejects a report without ids, sightings or a season', () => {
    const [first] = body.reports
    const fails = (r: unknown) =>
      !sunResponseSchema.safeParse({ reports: [r] }).success
    expect(fails({ ...first, ids: [] })).toBe(true)
    expect(fails({ ...first, sightings: [] })).toBe(true)
    expect(fails({ ...first, leafOff: 'no' })).toBe(true)
  })
})

describe('describeSunReport', () => {
  it('says the season, the people and whether it is shown', () => {
    expect(describeSunReport(report, true)).toBe('leaf-on · 2 people')
    expect(
      describeSunReport(
        { ...report, leafOff: true, reporters: 1, shown: true },
        false,
      ),
    ).toBe('leaf-off · 1 person · shown as ~ · stale: no longer in the data')
  })
})

describe('modelAt', () => {
  const summer = horizonFromRuns([[0, 359, 310]])
  const winter = horizonFromRuns([[0, 359, 120]])
  const low = packDegrees(new Array<number>(360).fill(25))

  it('reads the season’s horizon in the azimuth’s bin', () => {
    const terrace = {
      ...withoutHorizon,
      horizon: summer,
      horizon_winter: winter,
    }
    expect(modelAt(terrace, false, 176.3)).toEqual({
      obstacle: 31,
      atPin: null,
    })
    expect(modelAt(terrace, true, 176.3)).toEqual({ obstacle: 12, atPin: null })
    // No leaf-off horizon: the leaf-on one answers.
    expect(modelAt({ ...terrace, horizon_winter: null }, true, 0)).toEqual({
      obstacle: 31,
      atPin: null,
    })
  })

  it('compares with the envelope’s low half, as the app does', () => {
    expect(
      modelAt(
        { ...withoutHorizon, horizon: summer, horizon_low: low },
        false,
        90,
      ),
    ).toEqual({ obstacle: 25, atPin: 31 })
  })

  it('has nothing without a horizon', () => {
    expect(modelAt(withoutHorizon, false, 180)).toBeNull()
  })
})

describe('sightingRows', () => {
  it('lists the sightings oldest first, in Madrid time, against the model', () => {
    expect(sightingRows(report, paseoSanFrancisco)).toEqual([
      {
        id: 4,
        when: '2026-06-30 14:31',
        azimuth: 176.3,
        altitude: 27.1,
        model: { obstacle: 31, atPin: null },
        below: 3.9,
      },
      {
        id: 9,
        when: '2026-07-02 15:05',
        azimuth: 181.6,
        altitude: 26.4,
        model: { obstacle: 31, atPin: null },
        below: 4.6,
      },
    ])
  })

  it('has no model for a venue missing from the data', () => {
    expect(sightingRows(report, undefined)[0]).toMatchObject({
      model: null,
      below: null,
    })
  })
})
