import { describe, expect, it } from 'vitest'
import {
  DAILY_LIMIT,
  isTestSecret,
  limitHit,
  NETWORK_DAILY_LIMIT,
  turnstilePassed,
  VENUE_HOURLY_LIMIT,
  voterKeys,
} from './logic.ts'

describe('voterKeys', () => {
  it('keys IPv4 by address and its /24', () => {
    expect(voterKeys('83.44.10.7')).toEqual({ voter: '83.44.10.7', network: '83.44.10.0/24' })
  })

  it('gives every address of an IPv6 /64 the same voter', () => {
    const a = voterKeys('2a01:4f8:1c1c:9e2d:1111:2222:3333:4444')
    const b = voterKeys('2a01:4f8:1c1c:9e2d::1')
    expect(a).toEqual(b)
    expect(a).toEqual({ voter: '2a01:4f8:1c1c:9e2d::/64', network: '2a01:4f8:1c1c::/48' })
  })

  it('puts neighbouring /64s in one network but separate voters', () => {
    const a = voterKeys('2a01:4f8:1c1c:1::1')
    const b = voterKeys('2a01:4f8:1c1c:2::1')
    expect(a.voter).not.toBe(b.voter)
    expect(a.network).toBe(b.network)
  })

  it('normalises compressed and upper-case IPv6', () => {
    expect(voterKeys('2A01:04F8::1')).toEqual(voterKeys('2a01:4f8:0:0:9:9:9:9'))
  })

  it('treats IPv4-mapped IPv6 as IPv4', () => {
    expect(voterKeys('::ffff:83.44.10.7')).toEqual(voterKeys('83.44.10.7'))
  })

  it.each(['unknown', '', '300.1.1.1', '1:2:3', '1::2::3', 'fe80::1%eth0'])(
    'lumps unparseable %j into one key',
    (ip) => {
      expect(voterKeys(ip)).toEqual({ voter: 'unknown', network: 'unknown' })
    },
  )
})

describe('turnstilePassed', () => {
  const origins = 'https://isroma.github.io,http://localhost:5173'
  const pass = { success: true, hostname: 'isroma.github.io', action: 'suggest' }

  it('accepts our action on our hostname', () => {
    expect(turnstilePassed(pass, origins, false, 'suggest')).toBe(true)
    expect(turnstilePassed({ ...pass, hostname: 'localhost' }, origins, false, 'suggest')).toBe(true)
  })

  it.each([
    ['a failure', { ...pass, success: false }],
    ['another site', { ...pass, hostname: 'evil.example' }],
    ['another action', { ...pass, action: 'login' }],
    ['no action', { success: true, hostname: 'isroma.github.io' }],
    ['not an object', null],
  ])('refuses %s', (_, result) => {
    expect(turnstilePassed(result, origins, false, 'suggest')).toBe(false)
  })

  it('checks the action the caller expects', () => {
    expect(turnstilePassed({ ...pass, action: 'report' }, origins, false, 'report')).toBe(true)
    expect(turnstilePassed(pass, origins, false, 'report')).toBe(false)
  })

  it('skips hostname and action for test secrets, but not success', () => {
    expect(turnstilePassed({ success: true, hostname: 'example.com' }, origins, true, 'suggest')).toBe(true)
    expect(turnstilePassed({ success: false }, origins, true, 'suggest')).toBe(false)
  })

  it('recognises only the documented test secrets', () => {
    expect(isTestSecret('1x0000000000000000000000000000000AA')).toBe(true)
    expect(isTestSecret('2x0000000000000000000000000000000AA')).toBe(true)
    expect(isTestSecret('0x4AAAAAAAreal-secret')).toBe(false)
  })
})

describe('limitHit', () => {
  it('lets a suggestion in under every cap', () => {
    const counts = {
      voter: DAILY_LIMIT - 1,
      network: NETWORK_DAILY_LIMIT - 1,
      venue: VENUE_HOURLY_LIMIT - 1,
    }
    expect(limitHit(counts)).toBeNull()
  })

  it('names the first cap reached', () => {
    expect(limitHit({ voter: DAILY_LIMIT, network: 0, venue: 0 })).toBe('voter')
    expect(limitHit({ voter: 0, network: NETWORK_DAILY_LIMIT, venue: 0 })).toBe('network')
    expect(limitHit({ voter: 0, network: 0, venue: VENUE_HOURLY_LIMIT })).toBe('venue')
  })
})
