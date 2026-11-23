/**
 * Demo prices and ratings. There is no open data for them yet (beer prices are
 * planned, #8), so the UI shows these deterministic placeholders, always
 * labelled "ejemplo". They are derived from the venue id, never stored in the
 * data file.
 */
export type DemoValues = {
  /** Price of a caña, in cents. */
  priceCents: number
  /** Rating out of 5, one decimal. */
  rating: number
  reviews: number
}

/** 32-bit FNV-1a: stable across runs and browsers. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function demoValues(id: string): DemoValues {
  const h = hash(id)
  return {
    priceCents: 200 + (h % 15) * 10, // 2,00–3,40 €
    rating: Math.round((3.6 + ((h >>> 8) % 13) / 10) * 10) / 10, // 3,6–4,8
    reviews: 12 + ((h >>> 16) % 400),
  }
}

const PRICE = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
})
const RATING = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** "2,50 €" */
export function formatPrice(cents: number): string {
  return PRICE.format(cents / 100)
}

/** "4,3" */
export function formatRating(rating: number): string {
  return RATING.format(rating)
}
