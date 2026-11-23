import type { SunCategory, VenueStatus } from '../sun/venueStatus.ts'
import { formatClock, formatDuration } from '../time/madrid.ts'

/** Shared by the map pins, the list, the card and the legend. */
export const CATEGORY_COLORS: Record<SunCategory, string> = {
  sun: '#F59E0B',
  soon: '#F7C948',
  nosun: '#9CA3AF',
  unknown: '#C9CDD3',
}

export const CATEGORY_LABELS: Record<SunCategory, string> = {
  sun: 'Con sol ahora',
  soon: 'Le llega el sol en menos de 1 h',
  nosun: 'Sin sol',
  unknown: 'Terraza sin confirmar',
}

/** Badge text for a venue's category. */
export function categoryLabel(status: VenueStatus): string {
  if (status.category === 'unknown' && status.hasTerrace)
    return 'Sin datos de sol'
  if (status.category === 'soon') return 'Sol en menos de 1 h'
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
