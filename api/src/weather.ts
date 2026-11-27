/**
 * Whether the sun is out over Badajoz right now, to check a shade report
 * (ADR-0014): shade under a clear sky means something blocks the sun; under a
 * cloud it means nothing. Open-Meteo's current direct normal irradiance (DNI,
 * 15-minute model values, no key) at the city centre decides. Nothing about the
 * visitor is sent: the position is fixed.
 */

/** A shade report counts only with at least this DNI (W/m²); the WMO counts sunshine from 120. */
export const SHADE_MIN_DNI = 250

/** Badajoz's centre: one reading serves the whole city. */
export const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=38.879&longitude=-6.971&current=direct_normal_irradiance&timezone=UTC'

/** How long one isolate reuses a reading: Open-Meteo's values are 15-minute ones. */
const WEATHER_MEMO_MS = 15 * 60_000

let memo: { dni: number; until: number } | null = null

/** The DNI in an Open-Meteo answer, or null when it has none. */
export function parseDni(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const current: unknown = Reflect.get(body, 'current')
  if (typeof current !== 'object' || current === null) return null
  const dni: unknown = Reflect.get(current, 'direct_normal_irradiance')
  return typeof dni === 'number' && Number.isFinite(dni) && dni >= 0
    ? dni
    : null
}

/** The current DNI over Badajoz, or null when Open-Meteo can't be read. */
export async function directSunNow(now: number): Promise<number | null> {
  if (memo && memo.until > now) return memo.dni
  try {
    const response = await fetch(WEATHER_URL, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const dni = parseDni(await response.json())
    if (dni === null) return null
    memo = { dni, until: now + WEATHER_MEMO_MS }
    return dni
  } catch {
    return null
  }
}
