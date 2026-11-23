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

/**
 * The card that opens above a selected badge on the map: name, how much sun
 * is left and a bar from now to sunset with the moment the sun goes.
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
      <div className="pin-card-head">
        <span className="pin-card-badge" aria-hidden="true">
          <BeerIcon size={22} />
        </span>
        <div className="pin-card-title">
          <strong>{venue.name}</strong>
          <span>
            {KIND_LABELS[venue.kind]}
            {status.hasTerrace && ' · Terraza'}
          </span>
        </div>
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
            <span className="pin-card-fill" style={{ width: `${percent}%` }} />
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
  )
}
