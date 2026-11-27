import { useMemo, useState } from 'react'
import { dayTrack } from '../sun/dayTrack.ts'
import { isLeafOff } from '../sun/leafOff.ts'
import type { SunState } from '../sun/sunState.ts'
import { MINUTES_PER_DAY, toMadridLocal } from '../time/madrid.ts'
import { isTooHigh, terraceHorizon, type ProbeResult } from './probe.ts'
import { describeSun, stretches, sunSummary } from './sunSummary.ts'
import type { Outcome } from './useProbe.ts'

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
  // In the leaf-off period the app uses the leaf-off horizons, and so does this.
  const leafOff = isLeafOff(date)
  const summary = useMemo(
    () => sunSummary(terraceHorizon(result, leafOff), dayTrack(date)),
    [result, date, leafOff],
  )
  const height = result.height_above_ground
  const tooHigh = isTooHigh(result)
  const noSun = summary.minutes === 0
  return (
    <>
      <p className={noSun ? 'admin-sun-line admin-warn' : 'admin-sun-line'}>
        Today{leafOff ? ' (deciduous trees bare)' : ''}: {describeSun(summary)}
      </p>
      <DayStrip timeline={summary.timeline} now={now} />
      <p className="admin-sun-legend">
        On the map: amber cells get sun today (stronger = more), dark ones none;
        outlined ones are left out (canopy, roof, building or road).
      </p>
      <p className={tooHigh ? 'admin-sun-line admin-warn' : 'admin-sun-line'}>
        {height === null
          ? 'Height above ground: no LiDAR data at the pin'
          : `Height above ground: ${height.toFixed(1)} m`}
      </p>
      {noSun && (
        <p className="admin-warn-box">
          No sun today on any table within 7 m of the pin. If the tables do get
          sun, the pin is not where they stand: move it there.
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

/**
 * Today's sun on a terrace, from the LiDAR rasters via the dev server: sun
 * when any table within 7 m of the pin, off the road, has it, as the app shows it.
 */
export function SunPreview({
  outcome,
  loading,
}: {
  outcome: Outcome | null
  loading: boolean
}) {
  return (
    <section
      className="admin-sun"
      aria-label="Sun on the terrace"
      aria-busy={loading}
    >
      <h3 className="admin-subhead">
        Sun on the terrace
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
