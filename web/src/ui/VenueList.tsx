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
  /** Opens the picker to report a missing venue (optionally named); unset hides it. */
  onAdd?: (name?: string) => void
  /** The search, to offer adding the bar it doesn't find. */
  query?: string
  /** No venue at all has that name (filters aside). */
  nameUnknown?: boolean
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
  query = '',
  nameUnknown = false,
}: Props) {
  const [limit, setLimit] = useState(PAGE)
  const sunny = statuses.filter((s) => s.category === 'sun').length
  const shown = statuses.slice(0, limit)
  return (
    <section className="results" aria-labelledby="results-title">
      <div className="results-head">
        <h2 id="results-title" className="results-title">
          {statuses.length === total
            ? `${total} bares`
            : `${statuses.length} de ${total} bares`}
          <span> · {sunny} con sol ahora</span>
        </h2>
        {onAdd && (
          <button
            type="button"
            className="add-venue"
            aria-label="Añadir un bar que falta"
            title="¿Falta un bar? Añádelo"
            onClick={() => onAdd()}
          >
            + Añadir
          </button>
        )}
      </div>
      {statuses.length === 0 && nameUnknown ? (
        <div className="empty empty--search">
          <p>No hay bares con ese nombre.</p>
          {onAdd && (
            <button
              type="button"
              className="add-venue-offer"
              onClick={() => onAdd(query.trim())}
            >
              ¿Falta? <strong>Añádelo</strong>
            </button>
          )}
        </div>
      ) : statuses.length === 0 ? (
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
    </section>
  )
}
