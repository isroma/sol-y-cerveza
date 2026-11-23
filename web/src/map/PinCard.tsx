import type { VenueStatus } from '../sun/venueStatus.ts'
import { formatClock } from '../time/madrid.ts'
import { CategoryIcon } from '../ui/CategoryIcon.tsx'
import { BeerIcon } from '../ui/icons.tsx'
import { KIND_LABELS, sunBox } from '../ui/categoryStyle.ts'

type Props = {
  status: VenueStatus
  /** The chosen minute of the day. */
  minutes: number
  /** Today's sunset, for the end of the sun bar. */
  sunset: number | null
}

const clock = (m: number) => formatClock(m % (24 * 60))

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
 * from now to sunset with the moment the sun goes.
 */
export function PinCard({ status, minutes, sunset }: Props) {
  const { venue } = status
  const box = sunBox(status, minutes)
  const showBar =
    status.sunUntil !== null && sunset !== null && sunset > minutes
  const end = Math.max(sunset ?? 0, status.sunUntil ?? 0)
  const until = status.sunUntil ?? minutes
  const percent = showBar ? ((until - minutes) / (end - minutes)) * 100 : 0

  return (
    <div className={`pin-card pin-card--${status.category}`}>
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
          <span>
            {KIND_LABELS[venue.kind]}
            {status.hasTerrace && ' · Terraza'}
          </span>
        </div>
        <div className="pin-card-sun">
          <CategoryIcon category={status.category} size={30} />
          <div>
            <strong>{box.title}</strong>
            {box.detail && <span>{box.detail}</span>}
          </div>
        </div>
        {showBar && (
          <div className="pin-card-bar">
            <div className="pin-card-track">
              <span
                className="pin-card-fill"
                style={{ width: `${percent}%` }}
              />
              <span className="pin-card-knob" style={{ left: `${percent}%` }} />
            </div>
            <div className="pin-card-ticks">
              <span>{clock(minutes)}</span>
              <strong>{clock(until)}</strong>
              <span>{clock(end)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
