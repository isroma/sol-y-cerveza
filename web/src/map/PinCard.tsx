import { useEffect, useRef, useState } from 'react'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { CategoryIcon } from '../ui/CategoryIcon.tsx'
import { BeerIcon, ShareIcon } from '../ui/icons.tsx'
import { KIND_LABELS, sunBox, VISITORS_NOTE } from '../ui/categoryStyle.ts'
import { SunDay } from './SunDay.tsx'
import { PriceSection } from '../prices/PriceSection.tsx'
import { useCanSend, useOwner } from '../prices/owner.ts'
import { emptyDraft, useDraft, type ChangeDraft } from '../reports/draft.ts'
import { SuggestChange } from '../reports/SuggestChange.tsx'
import { shareUrl } from '../urlState.ts'
import { useMediaQuery } from '../ui/useMediaQuery.ts'

type Props = {
  status: VenueStatus
  /** The chosen minute of the day. */
  minutes: number
  /** Today's sunset (kept for callers; the countdown uses the sun spell). */
  sunset: number | null
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
 * Shares a link to the venue at the chosen time today: the system share
 * sheet where there is one, else the link goes to the clipboard. Not on the
 * card for now (issue #233); kept, with its tests, to bring back.
 */
export function ShareButton({
  name,
  id,
  text,
  minutes,
}: {
  name: string
  id: string
  text: string
  minutes: number
}) {
  const [note, setNote] = useState('')

  useEffect(() => {
    if (note === '') return
    const timer = window.setTimeout(() => setNote(''), 2000)
    return () => window.clearTimeout(timer)
  }, [note])

  const share = async () => {
    const url = shareUrl(window.location.href, id, minutes)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: name, text, url })
        return
      } catch (error) {
        // Closing the share sheet is not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setNote('Enlace copiado')
    } catch {
      setNote('No se ha podido copiar el enlace')
    }
  }

  return (
    <>
      <button
        type="button"
        className="icon-button pin-card-share"
        aria-label={`Compartir ${name}`}
        title="Compartir"
        onClick={() => void share()}
      >
        <ShareIcon size={20} />
      </button>
      <span className="pin-card-share-note" role="status">
        {note}
      </span>
    </>
  )
}

/**
 * The card a selected badge opens into on the map: the badge becomes a tab
 * joined to a card below it with the name, how much sun is left and a bar
 * counting down the current sun spell.
 */
/** Half a turn of the card, front to edge-on (see .is-turning-out). */
const FLIP_HALF_MS = 150

export function PinCard({ status, minutes }: Props) {
  const { venue } = status
  const box = sunBox(status, minutes)
  const { token } = useOwner()
  const canSend = useCanSend()
  // The open back's draft, kept by App across the map picker: the card shows
  // its back while the draft is this venue's. Switching venues turns it round.
  const { draft, setDraft } = useDraft()
  const showBack = draft?.venueId === venue.id
  // Turning round: the card turns edge-on ('out'), swaps sides, then turns
  // face-on again ('in').
  const [turn, setTurn] = useState<'out' | 'in' | null>(null)
  const turnTimer = useRef(0)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  useEffect(() => () => clearTimeout(turnTimer.current), [])
  /** Turns to the back (with what the front already answered), or the front. */
  const flipTo = (id: string | null, start: Partial<ChangeDraft> = {}) => {
    const swap = () =>
      setDraft(id === null ? null : { ...emptyDraft(id), ...start })
    if (reduceMotion) {
      swap()
      return
    }
    clearTimeout(turnTimer.current)
    setTurn('out')
    turnTimer.current = window.setTimeout(() => {
      swap()
      setTurn('in')
    }, FLIP_HALF_MS)
  }
  // The day strip shows whenever the terrace has a sun timeline.
  const bar = status.timeline !== null

  const suggest = canSend ? (
    <button
      type="button"
      className={bar ? 'card-suggest' : 'card-suggest card-suggest--alone'}
      onClick={() => flipTo(venue.id)}
    >
      {token ? 'Editar' : 'Sugerir un cambio'}
    </button>
  ) : null
  // Where the data doesn't know if there is a terrace, the front asks: an
  // answer turns the card with it chosen, so Sí then Enviar sends it.
  const ask =
    canSend && venue.terrace === null ? (
      <div
        className="card-ask"
        role="group"
        aria-labelledby={`card-ask-${venue.id}`}
      >
        <span id={`card-ask-${venue.id}`}>¿Tiene terraza?</span>
        <button
          type="button"
          onClick={() => flipTo(venue.id, { terrace: true })}
        >
          Sí
        </button>
        <button
          type="button"
          onClick={() => flipTo(venue.id, { terrace: false })}
        >
          No
        </button>
      </div>
    ) : null

  return (
    <div className={`pin-card pin-card--${status.category}`}>
      <div
        className={turn ? `pin-card-flip is-turning-${turn}` : 'pin-card-flip'}
      >
        <div className="pin-card-tab">
          <Shoulder side="left" />
          <span className="pin-card-badge" aria-hidden="true">
            <BeerIcon size={26} />
          </span>
          <Shoulder side="right" />
        </div>
        <div className="pin-card-body">
          {showBack && draft ? (
            <SuggestChange
              venue={venue}
              draft={draft}
              onChange={(patch) =>
                setDraft((d) => (d ? { ...d, ...patch } : d))
              }
              onBack={() => flipTo(null)}
            />
          ) : (
            <>
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
                  {status.byVisitors && (
                    <span className="pin-card-sun-note">{VISITORS_NOTE}</span>
                  )}
                </div>
              </div>
              {status.timeline && bar && (
                <SunDay
                  timeline={status.timeline}
                  approximate={status.approximate}
                  minutes={minutes}
                  middle={suggest}
                />
              )}
              <PriceSection venue={venue} />
              {ask}
              {!bar && suggest}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
