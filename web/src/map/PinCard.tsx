import type { VenueStatus } from '../sun/venueStatus.ts'
import { CategoryIcon } from '../ui/CategoryIcon.tsx'
import { BeerIcon } from '../ui/icons.tsx'
import { KIND_LABELS, sunBox } from '../ui/categoryStyle.ts'
import { SunCountdown } from './SunCountdown.tsx'
import { PriceSection } from '../prices/PriceSection.tsx'

type Props = {
  status: VenueStatus
  /** The chosen minute of the day. */
  minutes: number
  /** Today's sunset (kept for callers; the countdown uses the sun spell). */
  sunset: number | null
  /** Mid zoom: only the name and the sun line. */
  compact?: boolean
}

/** Shoulder radius where the badge tab flares into the card body. */
const R = 18
const r = R + 1.5

/**
 * A concave corner joining the tab's side to the card's top edge: white fill
 * plus the border-coloured curve. The right one is the mirror image.
 */
function Shoulder({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      className={`pin-card-shoulder pin-card-shoulder--${side}`}
      width={R + 3}
      height={R + 3}
      viewBox={`0 0 ${R + 3} ${R + 3}`}
      aria-hidden="true"
    >
      {/* The fill runs past the svg's edges (overflow is visible) so it also
          hides the tab's side border and the card's top border under the
          curve, with a 3 px overlap so no anti-aliased seam shows. */}
      <path
        d={`M0 ${r} A${r} ${r} 0 0 0 ${r} 0 L${R + 6} 0 L${R + 6} ${R + 6} L0 ${R + 6} Z`}
        fill="var(--bg)"
      />
      <path
        d={`M0 ${r} A${r} ${r} 0 0 0 ${r} 0`}
        fill="none"
        stroke="var(--card-accent)"
        strokeWidth="3"
      />
    </svg>
  )
}

/**
 * The card a selected badge opens into on the map: the badge becomes a tab
 * joined to a card below it with the name, how much sun is left and a bar
 * counting down the current sun spell.
 */
export function PinCard({ status, minutes, compact = false }: Props) {
  const { venue } = status
  const box = sunBox(status, minutes)

  return (
    <div
      className={`pin-card pin-card--${status.category}${compact ? ' pin-card--compact' : ''}`}
    >
      <div className="pin-card-tab">
        <Shoulder side="left" />
        <span className="pin-card-badge" aria-hidden="true">
          <BeerIcon size={26} />
        </span>
        <Shoulder side="right" />
      </div>
      <div className="pin-card-body">
        <div className="pin-card-title">
          <strong>{venue.name}</strong>
          {!compact && (
            <span>
              {KIND_LABELS[venue.kind]}
              {status.hasTerrace && ' · Terraza'}
            </span>
          )}
        </div>
        <div className="pin-card-sun">
          <CategoryIcon category={status.category} size={30} />
          <div>
            <strong>{box.title}</strong>
            {box.detail && <span>{box.detail}</span>}
          </div>
        </div>
        {!compact && status.timeline && (
          <SunCountdown timeline={status.timeline} minutes={minutes} />
        )}
        {!compact && <PriceSection venue={venue} />}
      </div>
    </div>
  )
}
