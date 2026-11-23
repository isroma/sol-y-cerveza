import { useCallback, useEffect, useRef, useState } from 'react'
import type { LatLon } from '../data/terraces.ts'

export type Fix = { at: LatLon; accuracy: number }

/** Why the browser gave no position, in English for the admin. */
function explain(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED)
    return window.isSecureContext
      ? 'location permission denied'
      : 'location needs HTTPS: use npm run admin:lan'
  if (error.code === error.TIMEOUT) return 'no GPS fix yet'
  return 'position unavailable'
}

/**
 * "Where am I": follows the device's position once started. `onFirstFix`
 * runs once per start, so the map centres on the first fix only.
 */
export function useLocate(onFirstFix: (fix: Fix) => void) {
  const [fix, setFix] = useState<Fix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const watchId = useRef<number | null>(null)
  const first = useRef(onFirstFix)
  const pending = useRef(false)
  useEffect(() => {
    first.current = onFirstFix
  })

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError(
        window.isSecureContext
          ? 'no geolocation in this browser'
          : 'location needs HTTPS: use npm run admin:lan',
      )
      return
    }
    pending.current = true
    setError(null)
    if (watchId.current !== null) return
    setWatching(true)
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const next = {
          at: {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          },
          accuracy: position.coords.accuracy,
        }
        setFix(next)
        setError(null)
        if (pending.current) {
          pending.current = false
          first.current(next)
        }
      },
      (failure) => {
        setError(explain(failure))
        if (
          failure.code === failure.PERMISSION_DENIED &&
          watchId.current !== null
        ) {
          navigator.geolocation.clearWatch(watchId.current)
          watchId.current = null
          setWatching(false)
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    )
  }, [])

  useEffect(
    () => () => {
      if (watchId.current !== null)
        navigator.geolocation.clearWatch(watchId.current)
    },
    [],
  )

  return { fix, error, watching, start }
}
