import { describe, expect, it } from 'vitest'
import { readUrlState, shareUrl, writeUrlState } from './urlState.ts'

describe('readUrlState', () => {
  it('reads the time and the venue', () => {
    expect(readUrlState('?t=13:00&v=osm:node/123')).toEqual({
      time: 780,
      venue: 'osm:node/123',
    })
  })

  it('defaults to following the clock with nothing selected', () => {
    expect(readUrlState('')).toEqual({ time: null, venue: null })
  })

  it('ignores bad values', () => {
    expect(readUrlState('?t=25:00&v=%3Cscript%3E')).toEqual({
      time: null,
      venue: null,
    })
    expect(readUrlState('?t=9:00&v=')).toEqual({ time: null, venue: null })
  })
})

describe('writeUrlState', () => {
  it('writes only what differs from the default', () => {
    expect(writeUrlState('', { time: null, venue: null })).toBe('')
    expect(writeUrlState('', { time: 845, venue: null })).toBe('?t=14:05')
    expect(writeUrlState('', { time: 780, venue: 'junta:01eb' })).toBe(
      '?t=13:00&v=junta:01eb',
    )
  })

  it('keeps other parameters and drops cleared ones', () => {
    expect(
      writeUrlState('?utm=x&t=10:00&v=a', { time: null, venue: null }),
    ).toBe('?utm=x')
  })

  it('round-trips through readUrlState', () => {
    const state = { time: 1230, venue: 'review:la-plaza' }
    expect(readUrlState(writeUrlState('', state))).toEqual(state)
  })
})

describe('shareUrl', () => {
  it('pins the venue and the time', () => {
    expect(
      shareUrl('https://example.org/sol/?utm=x#y', 'osm:node/1', 13 * 60 + 5),
    ).toBe('https://example.org/sol/?utm=x&t=13:05&v=osm:node/1')
  })
})
