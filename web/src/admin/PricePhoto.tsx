import { useEffect, useState } from 'react'
import { z } from 'zod'
import { formatCents, parseEuros } from '../data/prices.ts'
import {
  fitWithin,
  MAX_CENTS,
  MIN_CENTS,
  PHOTO_API,
  photoResponseSchema,
  proposalName,
  type Proposal,
} from './pricePhoto.ts'
import { priceKey, type VenuePrice } from './pricesCsv.ts'

type Props = {
  venueId: string
  prices: readonly VenuePrice[]
  today: string
  onSave: (price: VenuePrice) => void
}

const statusSchema = z.object({
  enabled: z.boolean(),
  hint: z.string().optional(),
})
type Status = z.infer<typeof statusSchema>

// Whether the dev server has ANTHROPIC_API_KEY: asked once per admin session.
let statusRequest: Promise<Status> | null = null
function fetchStatus(): Promise<Status> {
  statusRequest ??= fetch(PHOTO_API)
    .then(async (response) => statusSchema.parse(await response.json()))
    .catch(() => ({
      enabled: false,
      hint: 'The dev server does not answer: run `npm run admin`.',
    }))
  return statusRequest
}

/** Downscales the photo to Claude's size limit and re-encodes it as JPEG (base64). */
async function encodePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  })
  const { width, height } = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('this browser cannot resize images')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((done) =>
    canvas.toBlob(done, 'image/jpeg', 0.85),
  )
  if (!blob) throw new Error('could not encode the photo')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

type Draft = Proposal & { text: string; bad: boolean }

function toDraft(p: Proposal): Draft {
  return { ...p, text: formatCents(p.cents).replace(' €', ''), bad: false }
}

/**
 * "Read prices from a photo": the dev server sends the photo to the Claude
 * API and the prices it reads come back as proposals. Nothing is saved until
 * the owner accepts one (or all), through the usual price save.
 */
export function PricePhoto({ venueId, prices, today, onSave }: Props) {
  const [status, setStatus] = useState<Status | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [notes, setNotes] = useState<string[]>([])

  useEffect(() => {
    let live = true
    void fetchStatus().then((s) => {
      if (live) setStatus(s)
    })
    return () => {
      live = false
    }
  }, [])

  const read = async (file: File) => {
    setError('')
    setDrafts([])
    setNotes([])
    if (!file.type.startsWith('image/')) return setError('Pick an image.')
    setReading(true)
    try {
      const image = await encodePhoto(file)
      const response = await fetch(PHOTO_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, mediaType: 'image/jpeg' }),
      })
      const parsed = photoResponseSchema.safeParse(await response.json())
      if (!parsed.success)
        return setError(`Unexpected answer (HTTP ${response.status}).`)
      if ('error' in parsed.data) return setError(parsed.data.error)
      setDrafts(parsed.data.proposals.map(toDraft))
      setNotes(parsed.data.notes)
      if (parsed.data.proposals.length === 0 && parsed.data.notes.length === 0)
        setNotes(['No beer prices found in this photo.'])
    } catch (caught) {
      setError(String(caught))
    } finally {
      setReading(false)
    }
  }

  const keyOf = (d: Pick<Draft, 'item' | 'brand'>) =>
    priceKey({ venueId, item: d.item, brand: d.brand })
  const current = (d: Draft) => prices.find((p) => priceKey(p) === keyOf(d))

  /** Saves a draft if its price is valid; returns whether it did. */
  const accept = (d: Draft): boolean => {
    const cents = parseEuros(d.text)
    if (cents === null || cents < MIN_CENTS || cents > MAX_CENTS) {
      setDrafts((all) =>
        all.map((x) => (keyOf(x) === keyOf(d) ? { ...x, bad: true } : x)),
      )
      return false
    }
    onSave({ venueId, item: d.item, brand: d.brand, cents, seen: today })
    return true
  }
  const drop = (d: Draft) =>
    setDrafts((all) => all.filter((x) => keyOf(x) !== keyOf(d)))
  const acceptAll = () => {
    const kept = drafts.filter((d) => !accept(d))
    setDrafts((all) =>
      all.filter((x) => kept.some((k) => keyOf(k) === keyOf(x))),
    )
  }
  const discard = () => {
    setDrafts([])
    setNotes([])
    setError('')
  }

  const enabled = status?.enabled === true && !reading
  return (
    <div className="admin-photo">
      <label
        className={
          enabled ? 'admin-photo-pick' : 'admin-photo-pick admin-photo-off'
        }
      >
        {reading && <span className="admin-spinner" />}
        {reading ? 'Reading the photo…' : 'Read prices from a photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={!enabled}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file) void read(file)
          }}
        />
      </label>
      {status && !status.enabled && status.hint && (
        <p className="admin-meta">{status.hint}</p>
      )}
      {status?.enabled && drafts.length === 0 && !error && (
        <p className="admin-meta">
          The photo is sent to Anthropic's API from your machine (a few cents
          per photo); the app does not store it. You confirm every price.
        </p>
      )}
      {error && <p className="admin-photo-error">Could not read: {error}</p>}
      {drafts.length > 0 && (
        <p className="admin-meta">
          Read from the photo, not saved yet. Check each price, then accept it.
        </p>
      )}
      {drafts.length > 0 && (
        <ul
          className="admin-photo-list"
          aria-label="Prices read from the photo"
        >
          {drafts.map((d) => {
            const name = proposalName(d)
            const now = current(d)
            return (
              <li key={keyOf(d)}>
                <div className="admin-price-row">
                  <span>
                    {name}
                    {d.confidence === 'low' && (
                      <span className="admin-photo-low"> check</span>
                    )}
                  </span>
                  <input
                    className={
                      d.bad ? 'admin-price admin-price-bad' : 'admin-price'
                    }
                    aria-label={`Proposed ${name} price in euros`}
                    inputMode="decimal"
                    value={d.text}
                    onChange={(e) => {
                      const text = e.target.value
                      setDrafts((all) =>
                        all.map((x) =>
                          keyOf(x) === keyOf(d)
                            ? { ...x, text, bad: false }
                            : x,
                        ),
                      )
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && accept(d)) drop(d)
                    }}
                  />
                  <span className="admin-meta">€</span>
                  <button
                    type="button"
                    className="admin-photo-accept"
                    aria-label={`Accept ${name}`}
                    onClick={() => {
                      if (accept(d)) drop(d)
                    }}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="admin-price-remove"
                    aria-label={`Discard ${name}`}
                    onClick={() => drop(d)}
                  >
                    ×
                  </button>
                </div>
                <p className="admin-meta">
                  “{d.label}”
                  {now && ` · now ${formatCents(now.cents)} (seen ${now.seen})`}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="admin-photo-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {(drafts.length > 0 || notes.length > 0) && (
        <div className="admin-actions">
          {drafts.length > 0 && (
            <button type="button" onClick={acceptAll}>
              Accept all ({drafts.length})
            </button>
          )}
          <button type="button" onClick={discard}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
}
