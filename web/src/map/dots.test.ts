import { describe, expect, it } from 'vitest'
import { dayTrack } from '../sun/dayTrack.ts'
import { venueDay, venueStatus } from '../sun/venueStatus.ts'
import { calleMenacho, plazaAlta } from '../test/fixtures.ts'
import { dotsData, dotsUpdate } from './dots.ts'

const track = dayTrack('2026-06-21')
const noTerrace = { ...calleMenacho, id: 'osm:node/1', terrace: null }
const days = [venueDay(plazaAlta, track), venueDay(noTerrace, track)]
const at = (minutes: number) => days.map((day) => venueStatus(day, minutes))

describe('dotsData', () => {
  it('has a dot for each venue without a terrace', () => {
    const data = dotsData(at(600), noTerrace.id)
    expect(data.features).toEqual([
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [noTerrace.venue.lon, noTerrace.venue.lat],
        },
        properties: { id: noTerrace.id, selected: true, name: noTerrace.name },
      },
    ])
  })
})

describe('dotsUpdate', () => {
  it('sends the dots the first time', () => {
    const update = dotsUpdate(null, at(600), null)
    expect(update?.data).toEqual(dotsData(at(600), null))
  })

  it('sends nothing when only the time changes', () => {
    const first = dotsUpdate(null, at(600), null)
    expect(first).not.toBeNull()
    expect(dotsUpdate(first?.key ?? null, at(1200), null)).toBeNull()
  })

  it('sends the dots again when the selection changes', () => {
    const first = dotsUpdate(null, at(600), null)
    const next = dotsUpdate(first?.key ?? null, at(600), noTerrace.id)
    expect(next?.data.features[0]?.properties.selected).toBe(true)
  })

  it('sends the dots again when the venues change', () => {
    const first = dotsUpdate(null, at(600), null)
    expect(dotsUpdate(first?.key ?? null, at(600).slice(0, 1), null)).toEqual({
      key: expect.any(String),
      data: { type: 'FeatureCollection', features: [] },
    })
  })
})
