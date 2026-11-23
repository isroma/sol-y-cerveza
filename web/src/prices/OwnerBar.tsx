import { useEffect, useRef, useState } from 'react'
import type { Terrace } from '../data/terraces.ts'
import {
  distanceM,
  exitOwner,
  pickVenue,
  readOwnerPhoto,
  showMessage,
  unlockFromLocation,
  useOwner,
  type OwnerPhotoReading,
  type VenueRef,
} from './owner.ts'
import { refreshCrowdPrices } from './crowd.ts'
import { applyReading } from './ownerActions.ts'
import { currentPosition, preparePhoto } from './photoUpload.ts'
import './prices.css'

type Choice = {
  reading: OwnerPhotoReading
  options: VenueRef[]
  from: { lat: number; lon: number } | null
}

/**
 * Owner mode outside the card: turns it on from the private link, shows its
 * messages, and takes a photo with no bar open: the bar comes from the name on
 * the menu or where the photo was taken, or the owner picks it.
 */
export function OwnerBar({
  venues,
  onSelect,
}: {
  venues: readonly Terrace[]
  onSelect: (id: string) => void
}) {
  const { token, message } = useOwner()
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void unlockFromLocation()
  }, [])

  // The owner sees what they saved, not the 5-minute browser cache.
  useEffect(() => {
    if (token) void refreshCrowdPrices()
  }, [token])

  const refs: VenueRef[] = venues.map((v) => ({
    id: v.id,
    name: v.name,
    at: v.terrace ?? v.venue,
  }))

  const onPhoto = async (file: File) => {
    setBusy(true)
    setChoice(null)
    showMessage('Leyendo la foto…')
    try {
      const photo = await preparePhoto(file)
      const from = photo.at ?? (await currentPosition())
      const reading = await readOwnerPhoto(photo)
      if ('error' in reading) return showMessage(reading.error)
      const { sure, options } = pickVenue(refs, from, reading.barName)
      if (sure) {
        onSelect(sure.id)
        return await applyReading(sure, reading, photo.at)
      }
      if (options.length === 0)
        return showMessage(
          'No sé de qué bar es la foto. Abre el bar en el mapa y usa «Foto de la carta» en su tarjeta.',
        )
      showMessage(null)
      setChoice({ reading, options, from })
    } catch {
      showMessage('No se ha podido abrir la foto.')
    } finally {
      setBusy(false)
    }
  }

  const choose = (venue: VenueRef) => {
    if (!choice) return
    setChoice(null)
    onSelect(venue.id)
    // The owner said which bar it is: neither place nor name is in doubt.
    void applyReading(venue, choice.reading, null, null)
  }

  if (!token && !message) return null
  return (
    <div className="owner-bar" role="region" aria-label="Modo dueño">
      {message && (
        <p className="owner-message" role="status">
          {message}
          <button
            type="button"
            aria-label="Cerrar mensaje"
            onClick={() => showMessage(null)}
          >
            ×
          </button>
        </p>
      )}
      {choice && (
        <div className="owner-choice">
          <p>
            {choice.reading.barName
              ? `La carta dice «${choice.reading.barName}». ¿Qué bar es?`
              : '¿De qué bar es la foto?'}
          </p>
          {choice.options.map((v) => (
            <button key={v.id} type="button" onClick={() => choose(v)}>
              {v.name}
              {choice.from && (
                <small> {Math.round(distanceM(choice.from, v.at))} m</small>
              )}
            </button>
          ))}
          <button type="button" onClick={() => setChoice(null)}>
            Cancelar
          </button>
        </div>
      )}
      {token && (
        <div className="owner-actions">
          <span>Modo dueño</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void onPhoto(file)
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Leyendo…' : 'Foto de precios'}
          </button>
          <button type="button" onClick={exitOwner}>
            Salir
          </button>
        </div>
      )}
    </div>
  )
}
