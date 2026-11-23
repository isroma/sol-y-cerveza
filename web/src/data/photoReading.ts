import { BRAND_NAMES, BRANDS, ITEMS, type Brand, type Item } from './prices.ts'

/**
 * Reading beer prices from a photo of a bar's price board: the prompt, the
 * output schema and the price rules. No dependencies beyond prices.ts, so the
 * admin (web/src/admin/pricePhoto.ts) and the API Worker (api/) share it.
 */

/** The browser downscales to this long edge before upload (Claude's own resize limit). */
export const PHOTO_MAX_EDGE = 1568

/** The endpoint rejects larger images (decoded bytes). */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024

/** The same bounds as the CSV (pricesCsv.ts). */
export const MIN_CENTS = 50
export const MAX_CENTS = 1500

export const PHOTO_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const
export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number]

/** Width and height that fit within `max` on the long edge, never upscaled. */
export function fitWithin(
  width: number,
  height: number,
  max: number = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Bytes in a base64 string, without decoding it. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

/** The media type the first bytes say, or null when they are not an image we take. */
export function sniffImage(base64: string): PhotoMediaType | null {
  let head: string
  try {
    head = atob(base64.slice(0, 16))
  } catch {
    return null
  }
  const bytes = Array.from(head, (c) => c.charCodeAt(0))
  const starts = (...expected: number[]) =>
    expected.every((b, i) => bytes[i] === b)
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP')
    return 'image/webp'
  return null
}

/**
 * JSON schema for the model's structured output (`output_config.format`).
 * Bounds and the tercio/brand rule are checked afterwards in `toProposals`.
 */
export const PHOTO_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prices', 'notes'],
  properties: {
    prices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'brand', 'cents', 'label', 'confidence'],
        properties: {
          item: { type: 'string', enum: [...ITEMS] },
          brand: {
            anyOf: [{ type: 'string', enum: [...BRANDS] }, { type: 'null' }],
          },
          cents: { type: 'integer' },
          label: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const

/** One price as the model reports it (before the rules below). */
export type ReadPrice = {
  item: Item
  brand: Brand | null
  cents: number
  label: string
  confidence: 'high' | 'low'
}

/** A price read from the photo that passed the CSV rules. */
export type Proposal = {
  item: 'cana' | 'tercio'
  brand: Brand | null
  cents: number
  label: string
  confidence: 'high' | 'low'
}

/** The proposals that passed the rules, and notes on what was dropped. */
export type PhotoReading = { proposals: Proposal[]; notes: string[] }

export function proposalName(p: Pick<Proposal, 'item' | 'brand'>): string {
  return p.item === 'cana'
    ? 'Caña'
    : `Tercio ${p.brand ? BRAND_NAMES[p.brand] : '(no brand)'}`
}

function order(p: Pick<Proposal, 'item' | 'brand'>): number {
  return p.item === 'cana' ? -1 : BRANDS.indexOf(p.brand ?? 'cruzcampo')
}

/**
 * Applies the CSV rules to what the model read: cents within 50–1500, a
 * tercio needs a brand, a caña has none, one price per item and brand.
 * Whatever is dropped becomes a note, so the owner sees why.
 */
export function toProposals(prices: readonly ReadPrice[]): PhotoReading {
  const proposals: Proposal[] = []
  const notes: string[] = []
  for (const read of prices) {
    const label = read.label.trim() || proposalName(read)
    if (read.item === 'tercio' && read.brand === null) {
      notes.push(`"${label}": a tercio without a brand we list, skipped`)
      continue
    }
    if (read.cents < MIN_CENTS || read.cents > MAX_CENTS) {
      notes.push(`"${label}": ${read.cents} cents is out of range, skipped`)
      continue
    }
    const proposal: Proposal = {
      item: read.item,
      brand: read.item === 'cana' ? null : read.brand,
      cents: read.cents,
      label,
      confidence: read.confidence,
    }
    const twin = proposals.find(
      (p) => p.item === proposal.item && p.brand === proposal.brand,
    )
    if (twin) {
      if (twin.cents !== proposal.cents) {
        twin.confidence = 'low'
        notes.push(
          `"${label}": another price for ${proposalName(proposal)}, kept "${twin.label}"`,
        )
      }
      continue
    }
    proposals.push(proposal)
  }
  proposals.sort((a, b) => order(a) - order(b))
  return { proposals, notes }
}

// --- The prompt ---------------------------------------------------------------

export const PHOTO_SYSTEM_PROMPT = `You read beer prices from a photo of a bar's price board, menu or price list in Badajoz, Spain. A person will check every value you return before it is saved, so a missing price costs little and a wrong one costs a lot.

Report only prices you can read in the photo. Never guess, estimate, infer a typical price or fill in a price you cannot see. If a price is blurred, cut off, hidden or you are not sure which item it belongs to, leave it out and say so in notes.

Items (field "item"):
- "cana": the standard draught beer, written "caña" (also "cana", "caña de cerveza", or "cerveza" / "cerveza de barril" when it is plainly the standard draught glass). "doble", "tubo", "jarra", "pinta", "copa", "clara", "shandy" and alcohol-free draught are not a caña: ignore them, unless the board makes clear the price is the caña's (e.g. one price for "caña / tubo"); then report it with confidence "low".
- "tercio": a 33 cl bottle of beer, written "tercio", "1/3", "33 cl" or "botella 33". Only 33 cl bottles. A "quinto" or "botellín" is 20 cl: ignore it. Ignore cans ("lata"), 25 cl, 50 cl, litre bottles and alcohol-free or flavoured variants.

Brand (field "brand"):
- A caña always has brand null, even when the board names the draught brand.
- A tercio needs one of these ids, matched to what the board says: cruzcampo (Cruzcampo), mahou-5-estrellas (Mahou 5 Estrellas), estrella-galicia (Estrella Galicia), amstel (Amstel), heineken (Heineken), alhambra-especial (Alhambra Especial), san-miguel (San Miguel), estrella-damm (Estrella Damm), super-bock (Super Bock), sagres (Sagres).
- If the board says only "Mahou", use mahou-5-estrellas; if only "Alhambra", use alhambra-especial; in both cases set confidence "low". A different variant (e.g. Mahou Clásica, Alhambra Reserva 1925, Estrella Galicia 1906, Cruzcampo Especial, Cruzcampo Cruzial, San Miguel Selecta, Heineken 0,0) or a brand not on the list: do not report it as a price; add a note such as "Tercio Mahou Clásica 2,00: brand not in the list".
- If a tercio price has no brand you can tell, leave it out and add a note.

Price (field "cents"): integer euro cents. Spanish boards write "1,50", "1.5 €", "1'50", "1€50", "1,5" or "2 €": these are 150, 150, 150, 150, 150 and 200. If the board lists a separate terrace price ("terraza") and a bar price, report the terrace price and add a note with both.

Field "label": the item and price exactly as written on the board, e.g. "Tercio Mahou 1,80".

Field "confidence": "high" only when the item, the size, the brand (for a tercio) and every digit of the price are clearly legible and unambiguous; otherwise "low".

Report each item and brand once. Field "notes": short English notes on beer prices you saw but did not report, and why; at most 6. If the photo shows no beer prices, return an empty "prices" list and one note saying what the photo shows.`

export const PHOTO_USER_PROMPT =
  'Read the beer prices (caña, and tercios by brand) from this photo.'
