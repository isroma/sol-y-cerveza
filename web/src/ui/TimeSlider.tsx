import type { CSSProperties } from 'react'
import { STEP_MINUTES } from '../sun/sunState.ts'
import { formatClock } from '../time/madrid.ts'
import { nowMarker } from './nowMarker.ts'
import { SunriseIcon, SunsetIcon } from './icons.tsx'

/** Terrace hours shown on the slider. */
export const SLIDER_START = 8 * 60
export const SLIDER_END = 22 * 60
const TICKS = [8, 10, 12, 14, 16, 18, 20, 22].map((h) => h * 60)

type Props = {
  minutes: number
  onChange: (minutes: number) => void
  onNow: () => void
  /** The current time, marked on the bar once the thumb is dragged away. */
  now: number
  sunrise: number | null
  sunset: number | null
}

const inRange = (m: number | null): m is number =>
  m !== null && m >= SLIDER_START && m <= SLIDER_END
const percentOf = (m: number) =>
  ((m - SLIDER_START) / (SLIDER_END - SLIDER_START)) * 100

export function TimeSlider({
  minutes,
  onChange,
  onNow,
  now,
  sunrise,
  sunset,
}: Props) {
  const clamped = Math.min(SLIDER_END, Math.max(SLIDER_START, minutes))
  const percent = percentOf(clamped)
  const marker = inRange(now) ? nowMarker(now, minutes) : 'none'
  const at = (m: number) => ({ left: `${percentOf(m)}%` })
  return (
    <section className="time" aria-label="Hora">
      <div className="time-header">
        <output className="time-value" aria-live="polite">
          {formatClock(minutes)}
        </output>
      </div>
      <p className="visually-hidden">
        {[
          sunrise !== null && `Amanecer a las ${formatClock(sunrise)}`,
          sunset !== null && `atardecer a las ${formatClock(sunset)}`,
        ]
          .filter(Boolean)
          .join(', ')}
      </p>
      <div className="time-track">
        <div className="time-markers" aria-hidden="true">
          {inRange(sunrise) && (
            <span
              className="time-marker time-marker--sunrise"
              style={at(sunrise)}
              title={`Amanecer · ${formatClock(sunrise)}`}
            >
              <SunriseIcon size={12} />
            </span>
          )}
          {inRange(sunset) && (
            <span
              className="time-marker time-marker--sunset"
              style={at(sunset)}
              title={`Atardecer · ${formatClock(sunset)}`}
            >
              <SunsetIcon size={12} />
            </span>
          )}
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
        {marker !== 'none' && (
          <div className="time-now-layer">
            {/* The current time: tap anywhere around it to come back to now. */}
            <button
              type="button"
              className="time-now"
              style={at(now)}
              aria-label={`Volver a ahora (${formatClock(now)})`}
              title={`Volver a ahora · ${formatClock(now)}`}
              onClick={onNow}
            >
              {marker === 'label' && (
                <span className="time-now-bubble" aria-hidden="true">
                  Ahora
                </span>
              )}
              <span className="time-now-dot" />
            </button>
          </div>
        )}
      </div>
      <div className="time-ticks" aria-hidden="true">
        {TICKS.map((tick) => (
          <span key={tick}>{formatClock(tick)}</span>
        ))}
      </div>
    </section>
  )
}
