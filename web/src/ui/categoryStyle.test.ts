import { describe, expect, it } from 'vitest'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { pinLabel } from './categoryStyle.ts'

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
    state: 'sun',
    category: 'sun',
    timeline: null,
    sunUntil: null,
    nextSun: null,
    minutesLeft: null,
    ...patch,
  }
}

describe('pinLabel', () => {
  it('says until when the sun goes while sunny', () => {
    expect(pinLabel(status({ sunUntil: 17 * 60 + 15 }))).toBe('hasta 17:15')
  })

  it('says from when the sun comes back', () => {
    expect(
      pinLabel(status({ category: 'soon', state: 'shade', nextSun: 730 })),
    ).toBe('desde 12:10')
  })

  it('is empty without more sun today', () => {
    expect(pinLabel(status({ category: 'nosun', state: 'shade' }))).toBe('')
  })
})
