import type { SunCategory, VenueStatus } from '../sun/venueStatus.ts'
import { formatClock, formatDuration } from '../time/madrid.ts'

/** Shared by the map pins, the list, the card and the legend. */
export const CATEGORY_COLORS: Record<SunCategory, string> = {
  sun: '#F59E0B',
  soon: '#F7C948',
  nosun: '#9CA3AF',
  unknown: '#B59A80',
}

export const CATEGORY_LABELS: Record<SunCategory, string> = {
  sun: 'Con sol ahora',
  soon: 'Sol pronto',
  nosun: 'Sin sol',
  unknown: 'Terraza sin confirmar',
}

/** "Sobre los datos" on the winter rule (ADR-0007). */
export const LEAF_OFF_INFO =
  'Del 1 de diciembre al 15 de marzo damos por hecho que los árboles que pierden la hoja no dan sombra; los de hoja perenne, sí. Los distinguimos con imágenes del satélite Sentinel-2, así que puede haber algún fallo.'

/** Badge text for a venue's category. */
export function categoryLabel(status: VenueStatus): string {
  if (status.category === 'unknown' && status.hasTerrace)
    return 'Sin datos de sol'
  if (status.category === 'soon') return 'Sol pronto'
  return CATEGORY_LABELS[status.category]
}

/** "Sol hasta las 17:25 (2 h 53 min)", "Sol desde las 12:10 (en 40 min)", … */
export function sunSummary(status: VenueStatus, minutes: number): string {
  if (status.category === 'unknown') {
    return status.hasTerrace
      ? 'Aún no sabemos qué sombra le da'
      : 'No sabemos si tiene terraza'
  }
  if (status.sunUntil !== null) {
    return `Sol hasta las ${formatClock(status.sunUntil % (24 * 60))} (${formatDuration(status.sunUntil - minutes)})`
  }
  if (status.nextSun !== null) {
    return `Sol desde las ${formatClock(status.nextSun)} (en ${formatDuration(status.nextSun - minutes)})`
  }
  return status.state === 'night'
    ? 'De noche · sin más sol hoy'
    : 'Sin más sol hoy'
}

/** Venue kinds as shown in the app. */
export const KIND_LABELS = {
  bar: 'Bar',
  pub: 'Pub',
  cafe: 'Café',
  restaurant: 'Restaurante',
  biergarten: 'Cervecería al aire libre',
} as const

/** Headline and detail of the sun box for a venue at the chosen minute. */
export function sunBox(
  status: VenueStatus,
  minutes: number,
): { title: string; detail: string | null } {
  if (status.sunUntil !== null)
    return {
      title: `${formatDuration(status.sunUntil - minutes)} de sol`,
      detail: `Hasta las ${formatClock(status.sunUntil % (24 * 60))}`,
    }
  if (status.nextSun !== null)
    return {
      title: `Sol en ${formatDuration(status.nextSun - minutes)}`,
      detail: `Desde las ${formatClock(status.nextSun)}`,
    }
  if (status.category === 'unknown')
    return { title: 'Sin datos de sol', detail: null }
  return {
    title: status.state === 'night' ? 'De noche' : 'Sin más sol hoy',
    detail: null,
  }
}
