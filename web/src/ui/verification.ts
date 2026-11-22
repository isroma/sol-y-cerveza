// `verified` is a calendar date, so format it in UTC to avoid shifting the day.
const DATE_FORMAT = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** Label for the on-site check of a terrace position (`verified`: YYYY-MM-DD or null). */
export function verificationLabel(verified: string | null): string {
  if (verified === null) return 'Posición sin verificar'
  return `Posición verificada el ${DATE_FORMAT.format(new Date(`${verified}T00:00:00Z`))}`
}
