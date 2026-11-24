import type { ReactNode } from 'react'
import { currentSunRun } from '../sun/venueStatus.ts'
import type { SunState } from '../sun/sunState.ts'
import { formatClock, formatDuration } from '../time/madrid.ts'

type Props = {
  /** The venue's sun/shade per step of the day. */
  timeline: readonly SunState[]
  /** The chosen minute of the day. */
  minutes: number
  /** Sits centred between the start and end times. */
  middle?: ReactNode
}

const clock = (m: number) => formatClock(m % (24 * 60))

/**
 * Progress through the current sun spell: the bar fills from when the sun
 * arrived and is full when it goes. A plain progress bar with no knob, so it
 * doesn't look draggable.
 * Shows nothing outside a sun spell.
 */
export function SunCountdown({ timeline, minutes, middle }: Props) {
  const run = currentSunRun(timeline, minutes)
  if (!run) return null
  const [start, end] = run
  const left = end - minutes
  const percent = Math.max(
    0,
    Math.min(100, ((minutes - start) / (end - start)) * 100),
  )
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
          className={`sun-countdown-fill${percent > 80 ? ' is-low' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="sun-countdown-ticks">
        <span>{clock(start)}</span>
        {middle}
        <strong>{clock(end)}</strong>
      </div>
    </div>
  )
}
