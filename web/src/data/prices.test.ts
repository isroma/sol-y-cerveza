import { describe, expect, it } from 'vitest'
import { BRAND_NAMES, BRANDS, formatCents, parseEuros } from './prices.ts'

describe('prices', () => {
  it('formats cents as Spanish euros', () => {
    expect(formatCents(150)).toBe('1,50 €')
    expect(formatCents(205)).toBe('2,05 €')
  })

  it('parses what people type', () => {
    expect(parseEuros('1,5')).toBe(150)
    expect(parseEuros('1.50')).toBe(150)
    expect(parseEuros(' 2,05 € ')).toBe(205)
    expect(parseEuros('2')).toBe(200)
    expect(parseEuros('abc')).toBeNull()
    expect(parseEuros('1,505')).toBeNull()
  })
})

describe('brands', () => {
  it('are listed by name, with "Otra marca" last', () => {
    const names = BRANDS.map((b) => BRAND_NAMES[b])
    expect(names.at(-1)).toBe('Otra marca')
    const listed = names.slice(0, -1)
    expect(listed).toEqual([...listed].sort((a, b) => a.localeCompare(b, 'es')))
  })
})
