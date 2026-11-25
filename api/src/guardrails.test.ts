import { describe, expect, it } from 'vitest'
import {
  DAILY_LIMIT,
  isLocalRequest,
  isTestSecret,
  limitHit,
  MIN_SALT_LENGTH,
  NETWORK_DAILY_LIMIT,
  parsePriceResolution,
  saltUsable,
  turnstilePassed,
  VENUE_HOURLY_LIMIT,
  voterKeys,
} from './logic.ts'

describe('voterKeys', () => {
  it('keys IPv4 by address and its /24', () => {
    expect(voterKeys('83.44.10.7')).toEqual({
      voter: '83.44.10.7',
      network: '83.44.10.0/24',
    })
  })

  it('gives every address of an IPv6 /64 the same voter', () => {
    const a = voterKeys('2a01:4f8:1c1c:9e2d:1111:2222:3333:4444')
    const b = voterKeys('2a01:4f8:1c1c:9e2d::1')
    expect(a).toEqual(b)
    expect(a).toEqual({
      voter: '2a01:4f8:1c1c:9e2d::/64',
      network: '2a01:4f8:1c1c::/48',
    })
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
  const pass = {
    success: true,
    hostname: 'isroma.github.io',
    action: 'suggest',
  }

  it('accepts our action on our hostname', () => {
    expect(turnstilePassed(pass, origins, false, 'suggest')).toBe(true)
    expect(
      turnstilePassed(
        { ...pass, hostname: 'localhost' },
        origins,
        false,
        'suggest',
      ),
    ).toBe(true)
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
    expect(
      turnstilePassed({ ...pass, action: 'report' }, origins, false, 'report'),
    ).toBe(true)
    expect(turnstilePassed(pass, origins, false, 'report')).toBe(false)
  })

  it('skips hostname and action for test secrets, but not success', () => {
    expect(
      turnstilePassed(
        { success: true, hostname: 'example.com' },
        origins,
        true,
        'suggest',
      ),
    ).toBe(true)
    expect(turnstilePassed({ success: false }, origins, true, 'suggest')).toBe(
      false,
    )
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
    expect(limitHit({ voter: 0, network: NETWORK_DAILY_LIMIT, venue: 0 })).toBe(
      'network',
    )
    expect(limitHit({ voter: 0, network: 0, venue: VENUE_HOURLY_LIMIT })).toBe(
      'venue',
    )
  })

  it('counts every part of a multi-part change', () => {
    const counts = { voter: DAILY_LIMIT - 2, network: 0, venue: 0 }
    expect(limitHit(counts, 2)).toBeNull()
    expect(limitHit(counts, 3)).toBe('voter')
  })
})

describe('misconfiguration guards', () => {
  it('lets test secrets pass only on a local dev server', () => {
    expect(isLocalRequest('http://localhost:8787/v1/suggestions')).toBe(true)
    expect(isLocalRequest('http://127.0.0.1:8787/v1/suggestions')).toBe(true)
    expect(isLocalRequest('http://[::1]:8787/v1/suggestions')).toBe(true)
    expect(
      isLocalRequest(
        'https://sol-y-cerveza-api.example.workers.dev/v1/suggestions',
      ),
    ).toBe(false)
    expect(isLocalRequest('https://localhost.example.com/')).toBe(false)
    expect(isLocalRequest('not a url')).toBe(false)
  })

  it(`needs an IP_SALT of at least ${MIN_SALT_LENGTH} characters`, () => {
    expect(saltUsable(undefined)).toBe(false)
    expect(saltUsable('')).toBe(false)
    expect(saltUsable('x'.repeat(MIN_SALT_LENGTH - 1))).toBe(false)
    expect(saltUsable('x'.repeat(MIN_SALT_LENGTH))).toBe(true)
  })
})

describe('parsePriceResolution', () => {
  const base = {
    venueId: 'osm:node/1',
    item: 'cana',
    brand: null,
    cents: 150,
    status: 'rejected',
  }

  it('stores a caña with brand ""', () => {
    expect(parsePriceResolution(base)).toEqual({ ...base, brand: '' })
    expect(
      parsePriceResolution({
        ...base,
        item: 'tercio',
        brand: 'cruzcampo',
        status: 'accepted',
      }),
    ).toEqual({
      ...base,
      item: 'tercio',
      brand: 'cruzcampo',
      status: 'accepted',
    })
  })

  it.each([
    ['an unknown item', { ...base, item: 'pinta' }],
    ['a bad venue id', { ...base, venueId: 'nope' }],
    ['fractional cents', { ...base, cents: 1.5 }],
    ['an unknown status', { ...base, status: 'pending' }],
    ['not an object', null],
  ])('refuses %s', (_, body) => {
    expect(parsePriceResolution(body)).toBeNull()
  })
})
