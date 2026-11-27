import { SLIDER_END, SLIDER_START } from './TimeSlider.tsx'

const percentOf = (m: number) =>
  ((m - SLIDER_START) / (SLIDER_END - SLIDER_START)) * 100

/**
 * Where daylight starts and ends on the bar, in percent: before sunrise and
 * after sunset the bar is night (0 and 100 when the sun is up all along).
 */
export function daylight(
  sunrise: number | null,
  sunset: number | null,
): { rise: number; set: number } {
  const clampPercent = (m: number) => Math.min(100, Math.max(0, percentOf(m)))
  return {
    rise: sunrise === null ? 0 : clampPercent(sunrise),
    set: sunset === null ? 100 : clampPercent(sunset),
  }
}
