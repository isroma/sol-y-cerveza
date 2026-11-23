export const MINUTES_PER_DAY = 24 * 60

/** Wall-clock date and time in Europe/Madrid. */
export type MadridLocal = {
  date: string // YYYY-MM-DD
  minutes: number // minutes since local midnight
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Madrid',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function madridParts(instant: Date) {
  const parts = formatter.formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  }
}

/** Milliseconds Madrid's wall clock is ahead of UTC at `instant`. */
function madridOffsetMs(instant: Date): number {
  const p = madridParts(instant)
  const wallClockAsUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    p.hour,
    p.minute,
    p.second,
  )
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000
}

export function isDateString(value: string): boolean {
  return DATE_PATTERN.test(value)
}

export function toMadridLocal(instant: Date): MadridLocal {
  const p = madridParts(instant)
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: p.hour * 60 + p.minute,
  }
}

/**
 * The instant at which Madrid's wall clock shows `date` plus `minutes`.
 * `minutes` may reach MINUTES_PER_DAY (the next midnight).
 */
export function fromMadridLocal(date: string, minutes: number): Date {
  const match = DATE_PATTERN.exec(date)
  if (!match) throw new RangeError(`Invalid date: ${date}`)
  const wallClockAsUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    0,
    minutes,
  )
  // Guess the offset at the wall-clock time, then correct it once in case a
  // DST change lies between the guess and the real instant.
  const guess = wallClockAsUtc - madridOffsetMs(new Date(wallClockAsUtc))
  return new Date(wallClockAsUtc - madridOffsetMs(new Date(guess)))
}

/** "HH:MM" for minutes since midnight. */
export function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

/** Minutes since midnight for "HH:MM", or null if it is not a valid time. */
export function parseClock(value: string): number | null {
  const match = CLOCK_PATTERN.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const mins = Number(match[2])
  if (hours > 23 || mins > 59) return null
  return hours * 60 + mins
}

/** "3 h 15 min", "45 min", "2 h". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins} min`
  if (mins === 0) return `${hours} h`
  return `${hours} h ${mins} min`
}

/** The YYYY-MM-DD date `days` after `date` (calendar arithmetic, no time zones). */
export function addDays(date: string, days: number): string {
  const match = DATE_PATTERN.exec(date)
  if (!match) throw new RangeError(`Invalid date: ${date}`)
  const d = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  )
  return d.toISOString().slice(0, 10)
}

const DAY_LABEL = new Intl.DateTimeFormat('es-ES', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** "lun, 1 dic" for a YYYY-MM-DD date. */
export function formatDayLabel(date: string): string {
  return DAY_LABEL.format(new Date(`${date}T12:00:00Z`))
}
