import { describe, expect, it } from 'vitest'
import {
  calleMenacho,
  paseoSanFrancisco,
  plazaAlta,
  withoutHorizon,
} from '../test/fixtures.ts'
import { fromMadridLocal, MINUTES_PER_DAY } from '../time/madrid.ts'
import { terraceStatuses } from './terraceStatus.ts'

const terraces = [withoutHorizon, paseoSanFrancisco, calleMenacho, plazaAlta]

describe('terraceStatuses', () => {
  it('sorts sunny terraces first, then by minutes of sun left', () => {
    const statuses = terraceStatuses(
      terraces,
      fromMadridLocal('2026-12-21', 14 * 60),
      fromMadridLocal('2026-12-21', MINUTES_PER_DAY),
    )

    expect(
      statuses.map(({ terrace, state, minutesLeft }) => [
        terrace.id,
        state,
        minutesLeft,
      ]),
    ).toEqual([
      ['sample:plaza-alta', 'sun', 195],
      ['sample:calle-menacho', 'sun', 45],
      ['sample:paseo-san-francisco', 'shade', 0],
      ['sample:sin-horizonte', 'unknown', null],
    ])
  })

  it('puts the terrace with more sun left first among sunny ones', () => {
    const statuses = terraceStatuses(
      terraces,
      fromMadridLocal('2026-06-21', 10 * 60),
      fromMadridLocal('2026-06-21', MINUTES_PER_DAY),
    )

    expect(statuses.map(({ terrace, state }) => [terrace.id, state])).toEqual([
      ['sample:plaza-alta', 'sun'],
      ['sample:paseo-san-francisco', 'sun'],
      ['sample:calle-menacho', 'shade'],
      ['sample:sin-horizonte', 'unknown'],
    ])
  })
})
