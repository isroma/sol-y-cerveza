import { useEffect, useMemo, useState } from 'react'
import type { LatLon } from '../data/terraces.ts'
import { dayTrack } from '../sun/dayTrack.ts'
import type { SunState } from '../sun/sunState.ts'
import { MINUTES_PER_DAY, toMadridLocal } from '../time/madrid.ts'
import {
  isTooHigh,
  probeKey,
  probeOutputSchema,
  probeUrl,
  roundPosition,
  type ProbeResult,
} from './probe.ts'
import { describeSun, stretches, sunSummary } from './sunSummary.ts'

/** Wait this long after the pin stops moving before asking the dev server. */
const DEBOUNCE_MS = 350

type Outcome =
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

/** The probe at `at`, debounced and cached. `loading` while a newer one is on its way. */
function useProbe(at: LatLon | null): {
  outcome: Outcome | null
  loading: boolean
} {
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

const STRIP_COLORS: Record<SunState, string> = {
  sun: 'var(--accent)',
  shade: 'var(--muted)',
  night: 'var(--line)',
  unknown: 'var(--line)',
}

function DayStrip({
  timeline,
  now,
}: {
  timeline: readonly SunState[]
  now: number
}) {
  return (
    <div className="admin-strip">
      <svg
        viewBox={`0 0 ${MINUTES_PER_DAY} 10`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Sun (amber), shade (grey) and night over today"
      >
        {stretches(timeline).map((s) => (
          <rect
            key={s.start}
            x={s.start}
            width={s.end - s.start}
            y={0}
            height={10}
            fill={STRIP_COLORS[s.state]}
          />
        ))}
        <rect x={now - 4} width={8} y={0} height={10} fill="var(--ink)" />
      </svg>
      <div className="admin-strip-hours" aria-hidden="true">
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  )
}

function Result({ result }: { result: ProbeResult }) {
  // Today and the time when the result came in, in Madrid.
  const [{ date, minutes: now }] = useState(() => toMadridLocal(new Date()))
  const summary = useMemo(
    () => sunSummary(result.horizon, dayTrack(date)),
    [result, date],
  )
  const height = result.height_above_ground
  const tooHigh = isTooHigh(result)
  const noSun = summary.minutes === 0
  return (
    <>
      <p className={noSun ? 'admin-sun-line admin-warn' : 'admin-sun-line'}>
        Today: {describeSun(summary)}
      </p>
      <DayStrip timeline={summary.timeline} now={now} />
      <p className={tooHigh ? 'admin-sun-line admin-warn' : 'admin-sun-line'}>
        {height === null
          ? 'Height above ground: no LiDAR data at the pin'
          : `Height above ground: ${height.toFixed(1)} m`}
      </p>
      {noSun && (
        <p className="admin-warn-box">
          No sun today at the pin. If the tables do get sun, the pin is against
          a wall or under a tree: move it onto open ground where the tables
          stand.
        </p>
      )}
      {tooHigh && (
        <p className="admin-warn-box">
          The pin is {height?.toFixed(1)} m above the ground (over{' '}
          {result.max_height_above_ground} m): it sits on a roof, an awning or a
          tree crown. Move it to the street or square where the tables are.
        </p>
      )}
    </>
  )
}

/** Today's sun at a terrace position, from the LiDAR rasters via the dev server. */
export function SunPreview({ at }: { at: LatLon }) {
  const { outcome, loading } = useProbe(at)
  return (
    <section
      className="admin-sun"
      aria-label="Sun at the terrace pin"
      aria-busy={loading}
    >
      <h3 className="admin-subhead">
        Sun at the terrace pin
        {loading && <span className="admin-spinner admin-sun-spinner" />}
      </h3>
      {outcome === null && <p className="admin-sun-line">Checking…</p>}
      {outcome?.kind === 'error' && (
        <p className="admin-sun-line admin-sun-error">{outcome.message}</p>
      )}
      {outcome?.kind === 'ok' && (
        <div className={loading ? 'admin-sun-stale' : undefined}>
          <Result result={outcome.result} />
        </div>
      )}
    </section>
  )
}
