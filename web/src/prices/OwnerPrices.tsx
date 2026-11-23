import { useRef, useState } from 'react'
import {
  BRAND_NAMES,
  BRANDS,
  formatCents,
  parseEuros,
  type Brand,
  type Item,
} from '../data/prices.ts'
import type { Terrace } from '../data/terraces.ts'
import { refreshCrowdPrices, type ShownPrice } from './crowd.ts'
import {
  readOwnerPhoto,
  removeOwnerPrice,
  saveOwnerPrice,
  setPending,
  showMessage,
  useOwner,
} from './owner.ts'
import { applyReading, priceName } from './ownerActions.ts'
import { preparePhoto } from './photoUpload.ts'

/** A price box that saves on Enter or when it loses focus; empty removes it. */
function PriceBox({
  label,
  cents,
  onCommit,
}: {
  label: string
  cents: number | null
  onCommit: (cents: number | null) => void
}) {
  const shown = cents === null ? '' : formatCents(cents).replace(' €', '')
  const [text, setText] = useState(shown)
  const [bad, setBad] = useState(false)
  const commit = () => {
    if (text.trim() === shown) return setBad(false)
    if (text.trim() === '') {
      setBad(false)
      return onCommit(null)
    }
    const value = parseEuros(text)
    if (value === null || value < 50 || value > 1500) return setBad(true)
    setBad(false)
    onCommit(value)
  }
  return (
    <input
      className={bad ? 'owner-price owner-price--bad' : 'owner-price'}
      aria-label={label}
      inputMode="decimal"
      placeholder="0,00"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

/**
 * Owner mode in the venue card: edit the prices (saved as confirmed), read
 * them from a photo of the menu, and confirm what a photo left unclear.
 */
export function OwnerPrices({
  venue,
  prices,
}: {
  venue: Terrace
  prices: readonly ShownPrice[]
}) {
  const { pending } = useOwner()
  const waiting = pending.get(venue.id) ?? []
  const [busy, setBusy] = useState(false)
  const [brand, setBrand] = useState<Brand | ''>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const at = venue.terrace ?? venue.venue
  const ref = { id: venue.id, name: venue.name, at }

  const save = async (item: Item, b: Brand | null, cents: number | null) => {
    const ok =
      cents === null
        ? await removeOwnerPrice({ venueId: venue.id, item, brand: b })
        : await saveOwnerPrice({ venueId: venue.id, item, brand: b, cents })
    showMessage(ok ? null : 'No se ha podido guardar. Revisa la conexión.')
    if (ok) await refreshCrowdPrices()
  }

  const confirm = async (index: number, keep: boolean) => {
    const p = waiting[index]
    if (!p) return
    if (keep) await save(p.item, p.brand, p.cents)
    setPending(
      venue.id,
      waiting.filter((_, i) => i !== index),
    )
  }

  const onPhoto = async (file: File) => {
    setBusy(true)
    showMessage('Leyendo la foto…')
    try {
      const photo = await preparePhoto(file)
      const reading = await readOwnerPhoto(photo)
      if ('error' in reading) showMessage(reading.error)
      else await applyReading(ref, reading, photo.at)
    } catch {
      showMessage('No se ha podido abrir la foto.')
    } finally {
      setBusy(false)
    }
  }

  const cana = prices.find((p) => p.item === 'cana')
  const tercios = prices.filter((p) => p.item === 'tercio' && p.brand)
  const free = BRANDS.filter((b) => !tercios.some((t) => t.brand === b))

  return (
    <div className="owner-prices">
      <div className="owner-row">
        <span>Caña</span>
        <PriceBox
          key={`cana-${cana?.cents ?? ''}`}
          label="Precio de la caña en euros"
          cents={cana?.cents ?? null}
          onCommit={(c) => void save('cana', null, c)}
        />
        <span>€</span>
      </div>
      {tercios.map((t) => {
        const b = t.brand ?? 'cruzcampo'
        return (
          <div className="owner-row" key={b}>
            <span>Tercio {BRAND_NAMES[b]}</span>
            <PriceBox
              key={`${b}-${t.cents}`}
              label={`Precio del tercio ${BRAND_NAMES[b]} en euros`}
              cents={t.cents}
              onCommit={(c) => void save('tercio', b, c)}
            />
            <span>€</span>
          </div>
        )
      })}
      {free.length > 0 && (
        <div className="owner-row">
          <select
            aria-label="Añadir tercio"
            value={brand}
            onChange={(e) =>
              setBrand(BRANDS.find((b) => b === e.target.value) ?? '')
            }
          >
            <option value="">+ Tercio…</option>
            {free.map((b) => (
              <option key={b} value={b}>
                {BRAND_NAMES[b]}
              </option>
            ))}
          </select>
          {brand && (
            <>
              <PriceBox
                key={`new-${brand}`}
                label={`Precio del tercio ${BRAND_NAMES[brand]} en euros`}
                cents={null}
                onCommit={(c) => {
                  if (c === null) return
                  void save('tercio', brand, c)
                  setBrand('')
                }}
              />
              <span>€</span>
            </>
          )}
        </div>
      )}
      {waiting.length > 0 && (
        <ul className="owner-waiting" aria-label="Precios por confirmar">
          {waiting.map((p, i) => (
            <li key={`${p.item}-${p.brand ?? ''}`}>
              <span>
                {priceName(p)} <strong>{formatCents(p.cents)}</strong>
                <small>«{p.label}»</small>
              </span>
              <button type="button" onClick={() => void confirm(i, true)}>
                Guardar
              </button>
              <button
                type="button"
                aria-label={`Descartar ${priceName(p)}`}
                onClick={() => void confirm(i, false)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
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
        className="owner-photo"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? 'Leyendo la foto…' : 'Foto de la carta'}
      </button>
    </div>
  )
}
