import { fitWithin } from '../data/photoReading.ts'
import type { LatLon } from '../data/terraces.ts'

/**
 * A photo ready for the API: downscaled to Claude's own size limit and
 * re-encoded as JPEG (which also drops its metadata), plus where it was taken
 * when the file says so (read from the original first).
 */
export async function preparePhoto(
  file: File,
): Promise<{ image: string; mediaType: 'image/jpeg'; at: LatLon | null }> {
  // Loaded on first use: only venue owners upload photos, so exifr stays
  // out of every visitor's entry chunk.
  const at = await import('exifr')
    .then(({ gps }) => gps(file))
    .then((g) =>
      g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)
        ? { lat: g.latitude, lon: g.longitude }
        : null,
    )
    .catch(() => null)
  const bitmap = await createImageBitmap(file)
  const size = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return {
    image: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mediaType: 'image/jpeg',
    at,
  }
}

/** Where the phone is now, or null when the owner says no or it takes too long. */
export function currentPosition(): Promise<LatLon | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  })
}
