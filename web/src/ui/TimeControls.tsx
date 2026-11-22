import {
  formatClock,
  isDateString,
  MINUTES_PER_DAY,
  parseClock,
  toMadridLocal,
  type MadridLocal,
} from '../time/madrid.ts'
import { STEP_MINUTES } from '../sun/sunState.ts'

type Props = {
  value: MadridLocal
  onChange: (value: MadridLocal) => void
}

export function TimeControls({ value, onChange }: Props) {
  return (
    <section className="time-controls" aria-label="Fecha y hora">
      <div className="time-controls-row">
        <label>
          Fecha
          <input
            type="date"
            value={value.date}
            onChange={(event) => {
              const date = event.target.value
              if (isDateString(date)) onChange({ ...value, date })
            }}
          />
        </label>
        <label>
          Hora
          <input
            type="time"
            value={formatClock(value.minutes)}
            onChange={(event) => {
              const minutes = parseClock(event.target.value)
              if (minutes !== null) onChange({ ...value, minutes })
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => onChange(toMadridLocal(new Date()))}
        >
          Ahora
        </button>
      </div>
      <input
        type="range"
        className="time-slider"
        aria-label="Hora del día"
        min={0}
        max={MINUTES_PER_DAY - STEP_MINUTES}
        step={STEP_MINUTES}
        value={value.minutes}
        onChange={(event) =>
          onChange({ ...value, minutes: Number(event.target.value) })
        }
      />
      <p className="time-controls-hint">Hora de Badajoz (península)</p>
    </section>
  )
}
