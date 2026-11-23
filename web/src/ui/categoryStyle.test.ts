import { describe, expect, it } from 'vitest'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { pinSunText } from './categoryStyle.ts'

function status(patch: Partial<VenueStatus>): VenueStatus {
  return {
    venue: {
      id: 'curated:x',
      name: 'X',
      kind: 'bar',
      venue: { lat: 38.88, lon: -6.97 },
      terrace: { lat: 38.88, lon: -6.97 },
      sources: ['curated'],
      verified: null,
      horizon: null,
    },
    hasTerrace: true,
    state: 'shade',
    category: 'nosun',
    timeline: null,
    sunUntil: null,
    nextSun: null,
    minutesLeft: null,
    ...patch,
  }
}

describe('pinSunText', () => {
  const at14 = 14 * 60

  it('says how much sun is left while sunny', () => {
    expect(
      pinSunText(status({ category: 'sun', sunUntil: 16 * 60 + 5 }), at14),
    ).toBe('2 h 5 min de sol')
  })

  it('says when the sun comes', () => {
    expect(
      pinSunText(status({ category: 'soon', nextSun: at14 + 25 }), at14),
    ).toBe('Sol en 25 min')
  })

  it('covers no more sun, night and unknown', () => {
    expect(pinSunText(status({}), at14)).toBe('Sin más sol hoy')
    expect(pinSunText(status({ state: 'night' }), at14)).toBe('De noche')
    expect(pinSunText(status({ category: 'unknown' }), at14)).toBe(
      'Sin datos de sol',
    )
  })
})
