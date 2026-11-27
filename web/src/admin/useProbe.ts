import { useEffect, useState } from 'react'
import type { LatLon } from '../data/terraces.ts'
import {
  probeKey,
  probeOutputSchema,
  probeUrl,
  roundPosition,
  type ProbeResult,
} from './probe.ts'

/** Wait this long after the pin stops moving before asking the dev server. */
const DEBOUNCE_MS = 350

export type ProbeState = { outcome: Outcome | null; loading: boolean }

export type Outcome =
  { kind: 'ok'; result: ProbeResult } | { kind: 'error'; message: string }

// Probe results by rounded position, for the whole admin session.
const cache = new Map<string, ProbeResult>()

async function fetchProbe(at: LatLon, signal: AbortSignal): Promise<Outcome> {
  const response = await fetch(probeUrl(at), { signal })
  const parsed = probeOutputSchema.safeParse(await response.json())
  if (!parsed.success)
    return {
      kind: 'error',
      message: `unexpected answer (HTTP ${response.status})`,
    }
  if ('error' in parsed.data)
    return { kind: 'error', message: parsed.data.error }
  return { kind: 'ok', result: parsed.data }
}

/**
 * The probe at `at`, debounced and cached. `loading` while a newer one is on
 * its way. Call it once per page: the dev server runs one probe at a time, and
 * a newer request cancels the one before.
 */
export function useProbe(at: LatLon | null): ProbeState {
  const rounded = at && roundPosition(at)
  const lat = rounded?.lat ?? null
  const lon = rounded?.lon ?? null
  const key = lat === null || lon === null ? null : probeKey({ lat, lon })
  const [latest, setLatest] = useState<{ key: string; outcome: Outcome }>()

  useEffect(() => {
    if (lat === null || lon === null) return
    const position = { lat, lon }
    const positionKey = probeKey(position)
    if (cache.has(positionKey)) return
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      fetchProbe(position, abort.signal)
        .then((outcome) => {
          if (outcome.kind === 'ok') cache.set(positionKey, outcome.result)
          setLatest({ key: positionKey, outcome })
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted) return
          setLatest({
            key: positionKey,
            outcome: { kind: 'error', message: String(error) },
          })
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
  }, [lat, lon])

  if (key === null) return { outcome: null, loading: false }
  const cached = cache.get(key)
  if (cached) return { outcome: { kind: 'ok', result: cached }, loading: false }
  if (latest?.key === key) return { outcome: latest.outcome, loading: false }
  return { outcome: latest?.outcome ?? null, loading: true }
}
