import { BRAND_NAMES, formatCents } from '../data/prices.ts'
import type { LatLon } from '../data/terraces.ts'
import { refreshCrowdPrices } from './crowd.ts'
import {
  photoDoubt,
  saveOwnerPrice,
  setPending,
  showMessage,
  type OwnerPhotoReading,
  type OwnerProposal,
  type VenueRef,
} from './owner.ts'

export function priceName(p: Pick<OwnerProposal, 'item' | 'brand'>): string {
  return p.item === 'cana'
    ? 'Caña'
    : `Tercio ${p.brand ? BRAND_NAMES[p.brand] : ''}`.trim()
}

/**
 * Saves what a photo says for `venue`: clear readings save by themselves when
 * the photo fits the bar; anything unclear waits in the card for a tap.
 * `photoAt` is where the photo was taken (null when the owner chose the bar).
 */
export async function applyReading(
  venue: VenueRef,
  reading: OwnerPhotoReading,
  photoAt: LatLon | null,
  barName: string | null = reading.barName,
): Promise<void> {
  if (reading.proposals.length === 0) {
    setPending(venue.id, [])
    return showMessage(
      `No se ha leído ningún precio de caña o tercio para ${venue.name}.`,
    )
  }
  const doubt = photoDoubt(venue, photoAt, barName)
  const ask: OwnerProposal[] = []
  const saved: OwnerProposal[] = []
  for (const p of reading.proposals) {
    if (doubt || p.confidence === 'low') {
      ask.push(p)
      continue
    }
    const ok = await saveOwnerPrice({
      venueId: venue.id,
      item: p.item,
      brand: p.brand,
      cents: p.cents,
    })
    ;(ok ? saved : ask).push(p)
  }
  setPending(venue.id, ask)
  if (saved.length) await refreshCrowdPrices()
  const list = saved.map((p) => `${priceName(p)} ${formatCents(p.cents)}`)
  if (doubt)
    return showMessage(
      `${doubt} Revisa los precios en la tarjeta de ${venue.name} antes de guardarlos.`,
    )
  showMessage(
    [
      saved.length ? `Guardado en ${venue.name}: ${list.join(', ')}.` : '',
      ask.length
        ? `${ask.length === 1 ? 'Un precio necesita' : `${ask.length} precios necesitan`} tu confirmación en la tarjeta.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  )
}
