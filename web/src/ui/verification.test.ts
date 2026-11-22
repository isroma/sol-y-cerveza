import { describe, expect, it } from 'vitest'
import { verificationLabel } from './verification.ts'

describe('verificationLabel', () => {
  it('flags positions nobody has checked on site', () => {
    expect(verificationLabel(null)).toBe('Posición sin verificar')
  })

  it('shows the check date without shifting the day', () => {
    expect(verificationLabel('2026-11-01')).toBe(
      'Posición verificada el 1 nov 2026',
    )
    expect(verificationLabel('2026-12-31')).toBe(
      'Posición verificada el 31 dic 2026',
    )
  })
})
