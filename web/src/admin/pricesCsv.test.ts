import { describe, expect, it } from 'vitest'
import {
  formatPricesCsv,
  parsePricesCsv,
  priceKey,
  removePrice,
  upsertPrice,
  type VenuePrice,
} from './pricesCsv.ts'

const cana: VenuePrice = {
  venueId: 'osm:node/1',
  item: 'cana',
  brand: null,
  cents: 150,
  seen: '2026-11-23',
}
const tercio: VenuePrice = {
  venueId: 'osm:node/1',
  item: 'tercio',
  brand: 'cruzcampo',
  cents: 200,
  seen: '2026-11-23',
}

describe('venue prices CSV', () => {
  it('writes sorted rows and reads them back', () => {
    const text = formatPricesCsv([tercio, cana])
    expect(text).toBe(
      'venue_id,item,brand,cents,seen\n' +
        'osm:node/1,cana,,150,2026-11-23\n' +
        'osm:node/1,tercio,cruzcampo,200,2026-11-23\n',
    )
    expect(parsePricesCsv(text)).toEqual([cana, tercio])
  })

  it('rejects a tercio without a brand', () => {
    expect(() =>
      parsePricesCsv(
        'venue_id,item,brand,cents,seen\nosm:node/1,tercio,,200,2026-11-23\n',
      ),
    ).toThrow(':2:')
  })

  it('keeps one row per venue, item and brand', () => {
    const rows = upsertPrice([cana, tercio], { ...cana, cents: 160 })
    expect(rows).toHaveLength(2)
    expect(rows.find((p) => p.item === 'cana')?.cents).toBe(160)
    expect(removePrice(rows, priceKey(tercio))).toHaveLength(1)
  })
})
