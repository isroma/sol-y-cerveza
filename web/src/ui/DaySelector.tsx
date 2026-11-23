import { addDays, formatDayLabel, isDateString } from '../time/madrid.ts'
import { CalendarIcon } from './icons.tsx'

type Props = {
  date: string
  today: string
  onChange: (date: string) => void
}

export function DaySelector({ date, today, onChange }: Props) {
  const tomorrow = addDays(today, 1)
  const isOther = date !== today && date !== tomorrow
  return (
    <div className="day-selector" role="group" aria-label="Día">
      <label className="calendar-button" title="Elegir otra fecha">
        <CalendarIcon size={22} />
        <input
          type="date"
          aria-label="Fecha"
          value={date}
          onChange={(event) => {
            if (isDateString(event.target.value)) onChange(event.target.value)
          }}
        />
      </label>
      <button
        type="button"
        className="chip"
        aria-pressed={date === today}
        onClick={() => onChange(today)}
      >
        Hoy
      </button>
      <button
        type="button"
        className="chip"
        aria-pressed={date === tomorrow}
        onClick={() => onChange(tomorrow)}
      >
        Mañana
      </button>
      {isOther && (
        <span className="chip" aria-pressed="true" role="status">
          {formatDayLabel(date)}
        </span>
      )}
    </div>
  )
}
