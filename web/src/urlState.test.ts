import { describe, expect, it } from 'vitest'
import { readUrlState } from './urlState.ts'

describe('readUrlState', () => {
  it('reads a date and a time', () => {
    expect(readUrlState('?fecha=2026-06-21&hora=14:30')).toEqual({
      date: '2026-06-21',
      minutes: 870,
    })
  })

  it('ignores missing or invalid values', () => {
    expect(readUrlState('')).toEqual({ date: null, minutes: null })
    expect(readUrlState('?fecha=21/06/2026&hora=25:00')).toEqual({
      date: null,
      minutes: null,
    })
  })
})
