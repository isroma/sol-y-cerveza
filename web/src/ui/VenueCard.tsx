import { useState } from 'react'
import { sunRuns, type VenueStatus } from '../sun/venueStatus.ts'
import { formatClock } from '../time/madrid.ts'
import { CategoryIcon } from './CategoryIcon.tsx'
import {
  CATEGORY_COLORS,
  categoryLabel,
  KIND_LABELS,
  sunSummary,
} from './categoryStyle.ts'
import { ChevronRightIcon, CloseIcon, SunIcon } from './icons.tsx'
import { SunTimeline } from './SunTimeline.tsx'
import { verificationLabel } from './verification.ts'

type Props = { status: VenueStatus; minutes: number; onClose: () => void }

export function VenueCard({ status, minutes, onClose }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { venue } = status
  const runs = status.timeline ? sunRuns(status.timeline) : []

  return (
    <article className="venue-card" aria-labelledby="venue-card-title">
      <button
        type="button"
        className="icon-button card-close"
        aria-label="Cerrar ficha"
        onClick={onClose}
      >
        <CloseIcon size={16} />
      </button>
      <div className="card-main">
        <div className="card-info">
          <p
            className="card-badge"
            style={{ color: CATEGORY_COLORS[status.category] }}
          >
            <CategoryIcon category={status.category} size={18} />
            {categoryLabel(status)}
          </p>
          <h2 id="venue-card-title">{venue.name}</h2>
          <p className="card-meta">
            {KIND_LABELS[venue.kind]}
            {status.hasTerrace && (
              <>
                <span aria-hidden="true">·</span>
                Con terraza
              </>
            )}
          </p>
        </div>
      </div>
      <button
        type="button"
        className="card-footer"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <SunIcon size={22} className="card-footer-sun" />
        <span>{sunSummary(status, minutes)}</span>
        <ChevronRightIcon className="chevron" />
      </button>
      {expanded && (
        <div className="card-details">
          {status.timeline ? (
            <>
              <SunTimeline timeline={status.timeline} minutes={minutes} />
              <p>
                {runs.length === 0
                  ? 'Sin sol directo en todo el día.'
                  : `Sol: ${runs.map(([a, b]) => `${formatClock(a)}–${formatClock(b)}`).join(', ')}`}
              </p>
            </>
          ) : (
            <p>
              {status.hasTerrace
                ? 'Aún no hemos calculado las sombras de esta terraza.'
                : 'No sabemos si este bar tiene terraza ni dónde están sus mesas.'}
            </p>
          )}
          {status.hasTerrace && (
            <p className="muted">{verificationLabel(venue.verified)}</p>
          )}
        </div>
      )}
    </article>
  )
}
