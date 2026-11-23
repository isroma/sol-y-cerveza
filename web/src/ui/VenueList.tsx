import { demoValues, formatPrice } from '../demo/demo.ts'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { CategoryIcon } from './CategoryIcon.tsx'
import { sunSummary } from './categoryStyle.ts'

type Props = {
  statuses: readonly VenueStatus[]
  total: number
  minutes: number
  selectedId: string | null
  onSelect: (id: string) => void
}

export function VenueList({
  statuses,
  total,
  minutes,
  selectedId,
  onSelect,
}: Props) {
  const sunny = statuses.filter((s) => s.category === 'sun').length
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
          {statuses.map((status) => (
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
                <span className="venue-row-price">
                  {formatPrice(demoValues(status.venue.id).priceCents)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
