import type { CSSProperties } from 'react'
import { STEP_MINUTES } from '../sun/sunState.ts'
import { formatClock } from '../time/madrid.ts'
import { ClockIcon } from './icons.tsx'

/** Terrace hours shown on the slider. */
export const SLIDER_START = 8 * 60
export const SLIDER_END = 22 * 60
const TICKS = [8, 10, 12, 14, 16, 18, 20, 22].map((h) => h * 60)

type Props = {
  minutes: number
  onChange: (minutes: number) => void
  onNow: () => void
}

export function TimeSlider({ minutes, onChange, onNow }: Props) {
  const clamped = Math.min(SLIDER_END, Math.max(SLIDER_START, minutes))
  const percent = ((clamped - SLIDER_START) / (SLIDER_END - SLIDER_START)) * 100
  return (
    <section className="time" aria-label="Hora">
      <div className="time-header">
        <ClockIcon size={24} />
        <output className="time-value" aria-live="polite">
          {formatClock(minutes)}
        </output>
        <button type="button" className="link-button" onClick={onNow}>
          Ahora
        </button>
      </div>
      <input
        type="range"
        className="time-slider"
        aria-label="Hora del día"
        aria-valuetext={formatClock(minutes)}
        min={SLIDER_START}
        max={SLIDER_END}
        step={STEP_MINUTES}
        value={clamped}
        style={{ '--fill': `${percent}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="time-ticks" aria-hidden="true">
        {TICKS.map((tick) => (
          <span key={tick}>{formatClock(tick)}</span>
        ))}
      </div>
    </section>
  )
}
