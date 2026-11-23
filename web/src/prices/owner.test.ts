import { describe, expect, it } from 'vitest'
import {
  nameMatches,
  photoDoubt,
  pickVenue,
  tokenFromHash,
  type VenueRef,
} from './owner.ts'

// About 0.0001° of latitude is 11 m.
const pozos: VenueRef = {
  id: 'a',
  name: 'Bar Los Pozos',
  at: { lat: 38.8875, lon: -6.9784 },
}
const chefa: VenueRef = {
  id: 'b',
  name: 'La Chefa',
  at: { lat: 38.8879, lon: -6.9784 },
}
const far: VenueRef = {
  id: 'c',
  name: 'Cervecería Pepe Jerez',
  at: { lat: 38.8775, lon: -6.9784 },
}
const venues = [pozos, chefa, far]

describe('owner link', () => {
  it('takes only a long token from #owner=', () => {
    expect(tokenFromHash('#owner=0123456789abcdef0123')).toBe(
      '0123456789abcdef0123',
    )
    expect(tokenFromHash('#owner=short')).toBeNull()
    expect(tokenFromHash('#other=0123456789abcdef0123')).toBeNull()
  })
})

describe('bar names', () => {
  it('match without generic words, accents or case', () => {
    expect(nameMatches('LOS POZOS', 'Bar Los Pozos')).toBe(true)
    expect(nameMatches('Cervecería Pepe Jerez', 'Pepe Jerez')).toBe(true)
    expect(nameMatches('La Chefa', 'Bar Los Pozos')).toBe(false)
    expect(nameMatches('Bar', 'Bar Los Pozos')).toBe(false)
  })
})

describe('photo doubts in an open card', () => {
  it('fit when taken there and the menu has no other name', () => {
    expect(photoDoubt(pozos, pozos.at, null)).toBeNull()
    expect(photoDoubt(pozos, null, 'Los Pozos')).toBeNull()
  })

  it('doubt a photo taken far away or naming another bar', () => {
    expect(photoDoubt(pozos, far.at, null)).toMatch(/a \d+ m de Bar Los Pozos/)
    expect(photoDoubt(pozos, null, 'La Chefa')).toBe(
      'La carta dice «La Chefa».',
    )
  })
})

describe('picking the bar for a photo with no card open', () => {
  it('trusts the name on the menu among nearby bars', () => {
    expect(pickVenue(venues, pozos.at, 'La Chefa').sure?.id).toBe('b')
  })

  it('searches every bar by name when the photo has no location', () => {
    expect(pickVenue(venues, null, 'Pepe Jerez').sure?.id).toBe('c')
  })

  it('trusts the only bar right next to the photo', () => {
    const at = { lat: 38.88752, lon: -6.9784 }
    expect(pickVenue([pozos, far], at, null).sure?.id).toBe('a')
  })

  it('asks when two bars are equally close and nothing names one', () => {
    const between = { lat: 38.8877, lon: -6.9784 }
    const result = pickVenue(venues, between, null)
    expect(result.sure).toBeNull()
    expect(result.options.map((v) => v.id).sort()).toEqual(['a', 'b'])
  })
})
