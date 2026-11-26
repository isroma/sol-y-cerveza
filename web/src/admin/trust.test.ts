import { describe, expect, it } from 'vitest'
import { trustDetails, trustHint, trustResponse, type Trust } from './trust.ts'

const FILE = JSON.stringify({
  venues: [
    {
      venue_id: 'overture:a',
      tier: 'weak',
      position_doubtful: true,
      confidence: 0.72,
      datasets: ['BrightQuery'],
      junta: false,
    },
    {
      venue_id: 'overture:b',
      tier: 'strong',
      position_doubtful: false,
      confidence: 0.95,
      datasets: ['BrightQuery', 'meta'],
      junta: true,
    },
  ],
})

describe('trustResponse', () => {
  it('reads the file written by solycerveza.trust', () => {
    const { venues, missing } = trustResponse(FILE)
    expect(missing).toBe(false)
    expect(venues[0]).toEqual({
      venueId: 'overture:a',
      tier: 'weak',
      positionDoubtful: true,
      confidence: 0.72,
      datasets: ['BrightQuery'],
      junta: false,
    })
  })

  it('says when the file is missing', () => {
    expect(trustResponse(null)).toEqual({ venues: [], missing: true })
  })

  it('refuses a malformed file', () => {
    expect(() =>
      trustResponse('{"venues":[{"venue_id":"x","tier":"maybe"}]}'),
    ).toThrow()
  })
})

describe('trust labels', () => {
  function row(index: number): Trust {
    const found = trustResponse(FILE).venues[index]
    if (!found) throw new Error(`no row ${index}`)
    return found
  }
  const weak = row(0)
  const strong = row(1)

  it('hints weak sources and doubtful positions only', () => {
    expect(trustHint(weak)).toBe('Weak source, position doubtful')
    expect(trustHint(strong)).toBe('')
    expect(trustHint({ ...strong, positionDoubtful: true })).toBe(
      'Position doubtful',
    )
    expect(trustHint(undefined)).toBe('')
  })

  it('details what the tier is based on', () => {
    expect(trustDetails(strong)).toBe(
      'Strong source · Overture confidence 0.95 · datasets BrightQuery + meta · Junta register confirms it',
    )
    expect(trustDetails(weak)).toContain('position doubtful (BrightQuery only)')
  })
})
