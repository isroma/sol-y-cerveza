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

/** "Sobre los datos" on the winter rule (ADR-0007, #526). */
export const LEAF_OFF_INFO =
  'Los árboles de hoja caduca no dan sombra mientras Sentinel-2 los ve sin hojas (como tarde, del 1 de diciembre al 15 de abril).'

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
  // "~" when that sun leans on visitors' reports, as on the card.
  const about = status.byVisitors ? '~' : ''
  if (status.sunUntil !== null) {
    return `Sol hasta las ${formatClock(status.sunUntil % (24 * 60))} (${about}${formatDuration(status.sunUntil - minutes)})`
  }
  if (status.nextSun !== null) {
    return `Sol desde las ${formatClock(status.nextSun)} (en ${about}${formatDuration(status.nextSun - minutes)})`
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

/** Under the sun box's detail when its sun leans on visitors' reports. */
export const VISITORS_NOTE = 'Según los visitantes'

/**
 * Headline and detail of the sun box for a venue at the chosen minute. When
 * that sun spell leans on visitors' unconfirmed reports, the duration gets a
 * "~", like a visitors' price.
 */
export function sunBox(
  status: VenueStatus,
  minutes: number,
): { title: string; detail: string | null } {
  const about = status.byVisitors ? '~' : ''
  if (status.sunUntil !== null)
    return {
      title: `${about}${formatDuration(status.sunUntil - minutes)} de sol`,
      detail: `Hasta las ${formatClock(status.sunUntil % (24 * 60))}`,
    }
  if (status.nextSun !== null)
    return {
      title: `Sol en ${about}${formatDuration(status.nextSun - minutes)}`,
      detail: `Desde las ${formatClock(status.nextSun)}`,
    }
  if (status.category === 'unknown')
    return { title: 'Sin datos de sol', detail: null }
  return {
    title: status.state === 'night' ? 'De noche' : 'Sin más sol hoy',
    detail: null,
  }
}
