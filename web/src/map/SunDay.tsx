import type { ReactNode } from 'react'
import { STEP_MINUTES, type SunState } from '../sun/sunState.ts'
import { sunRuns } from '../sun/venueStatus.ts'
import { formatClock } from '../time/madrid.ts'
import { SLIDER_END, SLIDER_START } from '../ui/TimeSlider.tsx'

type Props = {
  /** The venue's sun/shade per step of the day. */
  timeline: readonly SunState[]
  /** The chosen minute of the day. */
  minutes: number
  /** Sits centred between the start and end times. */
  middle?: ReactNode
}

type Stretch = { state: 'sun' | 'shade' | 'night'; from: number; to: number }

const percent = (minute: number) =>
  ((minute - SLIDER_START) / (SLIDER_END - SLIDER_START)) * 100

/** The day from the time bar's start to its end, in stretches of one state. */
function stretches(timeline: readonly SunState[]): Stretch[] {
  const out: Stretch[] = []
  for (let m = SLIDER_START; m < SLIDER_END; m += STEP_MINUTES) {
    const raw = timeline[m / STEP_MINUTES]
    const state = raw === 'sun' || raw === 'night' ? raw : 'shade'
    const last = out.at(-1)
    if (last?.state === state) last.to = m + STEP_MINUTES
    else out.push({ state, from: m, to: m + STEP_MINUTES })
  }
  return out
}

/**
 * The venue's day at a glance, over the time bar's hours (08:00–22:00): sun,
 * shade and night as stretches of a strip, with a line at the chosen time
 * that moves with it. Not a control, so no knob.
 */
export function SunDay({ timeline, minutes, middle }: Props) {
  const spells = sunRuns(timeline)
    .map(([from, to]) => [
      Math.max(from, SLIDER_START),
      Math.min(to, SLIDER_END),
    ])
    .filter(([from = 0, to = 0]) => from < to)
  const label = spells.length
    ? `Sol hoy: ${spells
        .map(
          ([from = 0, to = 0]) =>
            `de ${formatClock(from)} a ${formatClock(to)}`,
        )
        .join(', ')}`
    : 'Sin sol hoy'
  const at = Math.min(SLIDER_END, Math.max(SLIDER_START, minutes))
  return (
    <div className="sun-day">
      <div className="sun-day-track" role="img" aria-label={label}>
        <div className="sun-day-strip">
          {stretches(timeline).map(({ state, from, to }) => (
            <span
              key={from}
              className={`sun-day-part is-${state}`}
              style={{
                left: `${percent(from)}%`,
                width: `${percent(to) - percent(from)}%`,
              }}
            />
          ))}
        </div>
        <span className="sun-day-now" style={{ left: `${percent(at)}%` }} />
      </div>
      <div className="sun-day-ticks">
        <span>{formatClock(SLIDER_START)}</span>
        {middle}
        <span>{formatClock(SLIDER_END)}</span>
      </div>
    </div>
  )
}
