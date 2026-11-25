/** Beer items and tercio brands, mirroring `solycerveza.prices` and docs/data-contract.md. */
export const ITEMS = ['cana', 'tercio'] as const
export type Item = (typeof ITEMS)[number]

/** The tercio brands most poured in Spain and in Badajoz; Portuguese ones are common at the border. */
/** Alphabetical by name, then "other" (any brand not listed) last. */
export const BRANDS = [
  'alhambra-especial',
  'amstel',
  'cruzcampo',
  'estrella-damm',
  'estrella-galicia',
  'heineken',
  'mahou-5-estrellas',
  'sagres',
  'san-miguel',
  'super-bock',
  'other',
] as const
export type Brand = (typeof BRANDS)[number]

/** Display names (proper nouns, so the same in every language). */
export const BRAND_NAMES: Record<Brand, string> = {
  cruzcampo: 'Cruzcampo',
  'mahou-5-estrellas': 'Mahou 5 Estrellas',
  'estrella-galicia': 'Estrella Galicia',
  amstel: 'Amstel',
  heineken: 'Heineken',
  'alhambra-especial': 'Alhambra Especial',
  'san-miguel': 'San Miguel',
  'estrella-damm': 'Estrella Damm',
  'super-bock': 'Super Bock',
  sagres: 'Sagres',
  other: 'Otra marca',
}

/**
 * The prices, in integer cents and inclusive, that visitors may suggest for
 * each item: anything outside is a typo or a joke. The API enforces it and
 * the app's form checks it before sending.
 */
export const SUGGEST_RANGE: Record<Item, readonly [number, number]> = {
  cana: [50, 600],
  tercio: [80, 800],
}

/** Integer cents as Spanish euros: 150 -> "1,50 €". */
export function formatCents(cents: number): string {
  const euros = Math.trunc(cents / 100)
  const rest = String(Math.abs(cents % 100)).padStart(2, '0')
  return `${euros},${rest} €`
}

/** "1,5", "1.50" or "1,50 €" -> 150; null when it is not a price. */
export function parseEuros(text: string): number | null {
  const match = /^\s*(\d{1,2})(?:[.,](\d{1,2}))?\s*€?\s*$/.exec(text)
  if (!match) return null
  const euros = Number(match[1])
  const fraction = (match[2] ?? '0').padEnd(2, '0')
  return euros * 100 + Number(fraction)
}
