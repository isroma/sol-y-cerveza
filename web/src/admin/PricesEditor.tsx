import { useState } from 'react'
import {
  BRAND_NAMES,
  BRANDS,
  formatCents,
  parseEuros,
  type Brand,
} from '../data/prices.ts'
import { priceKey, type VenuePrice } from './pricesCsv.ts'

type Props = {
  venueId: string
  prices: readonly VenuePrice[]
  today: string
  onSave: (price: VenuePrice) => void
  onRemove: (key: string) => void
}

/** A price box: saves on Enter or when it loses focus; empty removes the price. */
function PriceInput({
  label,
  price,
  onCommit,
}: {
  label: string
  price: VenuePrice | undefined
  onCommit: (cents: number | null) => void
}) {
  const shown = price ? formatCents(price.cents).replace(' €', '') : ''
  const [text, setText] = useState(shown)
  const [bad, setBad] = useState(false)
  const commit = () => {
    if (text.trim() === shown) return setBad(false)
    if (text.trim() === '') {
      setBad(false)
      return onCommit(null)
    }
    const cents = parseEuros(text)
    if (cents === null || cents < 50 || cents > 1500) return setBad(true)
    setBad(false)
    onCommit(cents)
  }
  return (
    <input
      className={bad ? 'admin-price admin-price-bad' : 'admin-price'}
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

export function PricesEditor({
  venueId,
  prices,
  today,
  onSave,
  onRemove,
}: Props) {
  const cana = prices.find((p) => p.item === 'cana')
  const tercios = prices
    .filter((p) => p.item === 'tercio')
    .sort(
      (a, b) =>
        BRANDS.indexOf(a.brand ?? 'cruzcampo') -
        BRANDS.indexOf(b.brand ?? 'cruzcampo'),
    )
  const free = BRANDS.filter((b) => !tercios.some((t) => t.brand === b))
  const [brand, setBrand] = useState<Brand | ''>('')

  const save =
    (item: 'cana' | 'tercio', brandOf: Brand | null) =>
    (cents: number | null) => {
      const key = priceKey({ venueId, item, brand: brandOf })
      if (cents === null) onRemove(key)
      else onSave({ venueId, item, brand: brandOf, cents, seen: today })
    }

  return (
    <div className="admin-prices">
      <div
        className="admin-price-row"
        title={cana ? `Seen ${cana.seen}` : undefined}
      >
        <span>Caña</span>
        <PriceInput
          key={`cana-${cana?.cents ?? ''}`}
          label="Caña price in euros"
          price={cana}
          onCommit={save('cana', null)}
        />
        <span className="admin-meta">€</span>
      </div>
      {tercios.map((t) => {
        const b = t.brand ?? 'cruzcampo'
        return (
          <div className="admin-price-row" key={b}>
            <span>Tercio {BRAND_NAMES[b]}</span>
            <PriceInput
              key={`${b}-${t.cents}`}
              label={`Tercio ${BRAND_NAMES[b]} price in euros`}
              price={t}
              onCommit={save('tercio', b)}
            />
            <span className="admin-meta">€</span>
            <button
              type="button"
              className="admin-price-remove"
              aria-label={`Remove tercio ${BRAND_NAMES[b]}`}
              onClick={() => onRemove(priceKey(t))}
            >
              ×
            </button>
          </div>
        )
      })}
      {free.length > 0 && (
        <div className="admin-price-row">
          <select
            aria-label="Tercio brand"
            value={brand}
            onChange={(e) => {
              const picked = BRANDS.find((b) => b === e.target.value)
              setBrand(picked ?? '')
            }}
          >
            <option value="">+ Tercio brand…</option>
            {free.map((b) => (
              <option key={b} value={b}>
                {BRAND_NAMES[b]}
              </option>
            ))}
          </select>
          {brand && (
            <>
              <PriceInput
                key={`new-${brand}`}
                label={`Tercio ${BRAND_NAMES[brand]} price in euros`}
                price={undefined}
                onCommit={(cents) => {
                  if (cents === null) return
                  save('tercio', brand)(cents)
                  setBrand('')
                }}
              />
              <span className="admin-meta">€</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
