import { describe as group, expect, it } from 'vitest'
import { describe, IDLE, isActive, isBusy } from './publishStatus.ts'

group('publish status', () => {
  it('blocks a new Publish only while building or pushing', () => {
    expect(isBusy({ ...IDLE, step: 'building' })).toBe(true)
    expect(isBusy({ ...IDLE, step: 'opening' })).toBe(false)
    expect(isActive({ ...IDLE, step: 'checks', pr: 86 })).toBe(true)
    expect(isActive({ ...IDLE, step: 'live' })).toBe(false)
  })

  it('counts the phone prices a Publish copies in', () => {
    expect(
      describe({ ...IDLE, step: 'building', decisions: 51, phonePrices: 3 }),
    ).toContain('51 decisions, 3 phone prices')
    expect(
      describe({ ...IDLE, step: 'building', decisions: 51, phonePrices: 0 }),
    ).not.toContain('phone')
  })
  it('says what is happening', () => {
    expect(describe({ ...IDLE, step: 'building', decisions: 51 })).toContain(
      '51 decisions',
    )
    expect(describe({ ...IDLE, step: 'checks', pr: 86 })).toContain('PR #86')
    expect(describe({ ...IDLE, step: 'failed', error: 'boom' })).toBe(
      'Failed: boom',
    )
  })
})
