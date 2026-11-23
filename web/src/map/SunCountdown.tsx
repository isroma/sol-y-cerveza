import { sunRuns } from '../sun/venueStatus.ts'
import type { SunState } from '../sun/sunState.ts'
import { formatClock, formatDuration } from '../time/madrid.ts'

type Props = {
  /** The venue's sun/shade per step of the day. */
  timeline: readonly SunState[]
  /** The chosen minute of the day. */
  minutes: number
}

const clock = (m: number) => formatClock(m % (24 * 60))

/**
 * How much of the current sun spell is left, as a bar that empties as the
 * chosen time moves on: full when the sun has just arrived, empty when it
 * goes. Shows nothing outside a sun spell.
 */
export function SunCountdown({ timeline, minutes }: Props) {
  const run = sunRuns(timeline).find(([a, b]) => a <= minutes && minutes < b)
  if (!run) return null
  const [start, end] = run
  const left = end - minutes
  const percent = Math.max(0, Math.min(100, (left / (end - start)) * 100))
  return (
    <div className="sun-countdown">
      <div
        className="sun-countdown-track"
        role="meter"
        aria-label="Sol que queda"
        aria-valuemin={0}
        aria-valuemax={end - start}
        aria-valuenow={left}
        aria-valuetext={`Quedan ${formatDuration(left)} de sol, hasta las ${clock(end)}`}
      >
        <span
          className={`sun-countdown-fill${percent < 20 ? ' is-low' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="sun-countdown-ticks">
        <span>{clock(start)}</span>
        <strong>{clock(end)}</strong>
      </div>
    </div>
  )
}
