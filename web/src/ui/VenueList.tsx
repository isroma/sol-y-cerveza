import { useState } from 'react'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { CategoryIcon } from './CategoryIcon.tsx'
import { sunSummary } from './categoryStyle.ts'

type Props = {
  statuses: readonly VenueStatus[]
  total: number
  minutes: number
  selectedId: string | null
  onSelect: (id: string) => void
  /** Opens the picker to report a missing venue; unset hides the button. */
  onAdd?: () => void
}

/** Rows shown at first and added per "Ver más": the full list is hundreds long. */
const PAGE = 40

export function VenueList({
  statuses,
  total,
  minutes,
  selectedId,
  onSelect,
  onAdd,
}: Props) {
  const [limit, setLimit] = useState(PAGE)
  const sunny = statuses.filter((s) => s.category === 'sun').length
  const shown = statuses.slice(0, limit)
  return (
    <section className="results" aria-labelledby="results-title">
      <h2 id="results-title" className="results-title">
        {statuses.length === total
          ? `${total} bares`
          : `${statuses.length} de ${total} bares`}
        <span> · {sunny} con sol ahora</span>
      </h2>
      {statuses.length === 0 ? (
        <p className="empty">Ningún bar cumple los filtros.</p>
      ) : (
        <ol className="venue-list">
          {shown.map((status) => (
            <li key={status.venue.id}>
              <button
                type="button"
                className="venue-row"
                aria-current={
                  status.venue.id === selectedId ? 'true' : undefined
                }
                onClick={() => onSelect(status.venue.id)}
              >
                <CategoryIcon category={status.category} />
                <span className="venue-row-text">
                  <span className="venue-row-name">{status.venue.name}</span>
                  <span className="venue-row-sun">
                    {sunSummary(status, minutes)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {statuses.length > shown.length && (
        <button
          type="button"
          className="more-button"
          onClick={() => setLimit(limit + PAGE)}
        >
          Ver más ({statuses.length - shown.length})
        </button>
      )}
      {onAdd && (
        <button type="button" className="add-venue" onClick={onAdd}>
          ¿Falta un bar? Añádelo
        </button>
      )}
    </section>
  )
}
