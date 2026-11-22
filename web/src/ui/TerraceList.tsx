import type { TerraceStatus } from '../sun/terraceStatus.ts'
import { formatDuration } from '../time/madrid.ts'
import { STATE_COLORS, STATE_LABELS, STATES } from './stateStyle.ts'
import { verificationLabel } from './verification.ts'

function sunLeftLabel(minutesLeft: number | null): string {
  if (minutesLeft === null) return 'Horizonte sin calcular'
  if (minutesLeft === 0) return 'Sin más sol hoy'
  return `Quedan ${formatDuration(minutesLeft)} de sol hoy`
}

export function TerraceList({
  statuses,
}: {
  statuses: readonly TerraceStatus[]
}) {
  return (
    <section className="terrace-list" aria-labelledby="terrace-list-title">
      <h2 id="terrace-list-title">Terrazas ({statuses.length})</h2>
      <ul className="legend" aria-label="Leyenda">
        {STATES.map((state) => (
          <li key={state}>
            <span
              aria-hidden="true"
              className="state-dot"
              style={{ background: STATE_COLORS[state] }}
            />
            {STATE_LABELS[state]}
          </li>
        ))}
      </ul>
      <ol className="terrace-items" aria-labelledby="terrace-list-title">
        {statuses.map(({ terrace, state, minutesLeft }) => (
          <li key={terrace.id} className="terrace-item">
            <span
              aria-hidden="true"
              className="state-dot"
              style={{ background: STATE_COLORS[state] }}
            />
            <div>
              <p className="terrace-name">{terrace.name}</p>
              <p className="terrace-detail">
                <strong>{STATE_LABELS[state]}</strong> ·{' '}
                {sunLeftLabel(minutesLeft)}
              </p>
              <p
                className={
                  terrace.verified === null
                    ? 'terrace-verification is-unverified'
                    : 'terrace-verification'
                }
              >
                {verificationLabel(terrace.verified)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
