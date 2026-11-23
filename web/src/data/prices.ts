/** Beer items and tercio brands, mirroring `solycerveza.prices` and docs/data-contract.md. */
export const ITEMS = ['cana', 'tercio'] as const
export type Item = (typeof ITEMS)[number]

/** The tercio brands most poured in Spain and in Badajoz; Portuguese ones are common at the border. */
export const BRANDS = [
  'cruzcampo',
  'mahou-5-estrellas',
  'estrella-galicia',
  'amstel',
  'heineken',
  'alhambra-especial',
  'san-miguel',
  'estrella-damm',
  'super-bock',
  'sagres',
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
