import { STEP_MINUTES, type SunState } from '../sun/sunState.ts'
import { sunRuns } from '../sun/venueStatus.ts'
import { formatClock } from '../time/madrid.ts'

const START = 6 * 60
const END = 23 * 60
const LABELS = [6, 10, 14, 18, 22].map((h) => h * 60)

const COLORS: Record<SunState, string> = {
  sun: '#F59E0B',
  shade: '#B8C1CC',
  night: '#4B4F6B',
  unknown: '#E5E7EB',
}

type Props = { timeline: readonly SunState[]; minutes: number }

/** The day as coloured stretches of sun, shade and night, with a "now" marker. */
export function SunTimeline({ timeline, minutes }: Props) {
  const span = END - START
  const segments: { state: SunState; from: number; to: number }[] = []
  timeline.forEach((state, i) => {
    const from = i * STEP_MINUTES
    const to = from + STEP_MINUTES
    if (to <= START || from >= END) return
    const last = segments.at(-1)
    if (last && last.state === state) last.to = to
    else segments.push({ state, from: Math.max(from, START), to })
  })
  const runs = sunRuns(timeline)
  const pct = (m: number) =>
    `${((Math.min(END, Math.max(START, m)) - START) / span) * 100}%`

  return (
    <div className="timeline">
      <div
        className="timeline-bar"
        role="img"
        aria-label={
          runs.length === 0
            ? 'Sin sol en todo el día'
            : `Sol: ${runs.map(([a, b]) => `${formatClock(a)}–${formatClock(b)}`).join(', ')}`
        }
      >
        {segments.map((segment) => (
          <span
            key={segment.from}
            style={{
              left: pct(segment.from),
              width: `calc(${pct(segment.to)} - ${pct(segment.from)})`,
              background: COLORS[segment.state],
            }}
          />
        ))}
        <i className="timeline-now" style={{ left: pct(minutes) }} />
      </div>
      <div className="timeline-labels" aria-hidden="true">
        {LABELS.map((label) => (
          <span key={label} style={{ left: pct(label) }}>
            {formatClock(label)}
          </span>
        ))}
      </div>
    </div>
  )
}
