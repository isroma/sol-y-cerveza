import { useState } from 'react'
import type { Filters } from '../filters/filters.ts'
import {
  BeerIcon,
  ChevronDownIcon,
  StarOutlineIcon,
  SunIcon,
  TerraceIcon,
} from './icons.tsx'
import { Toggle } from './Toggle.tsx'

type Props = { filters: Filters; onChange: (filters: Filters) => void }

const PRICE_OPTIONS = [
  { label: 'Cualquiera', value: '' },
  { label: 'Hasta 2,50 €', value: '250' },
  { label: 'Hasta 3,00 €', value: '300' },
]
const RATING_OPTIONS = [
  { label: 'Cualquiera', value: '' },
  { label: '4,0 o más', value: '4' },
  { label: '4,5 o más', value: '4.5' },
]

function DemoTag() {
  return (
    <span className="demo-tag" title="Precios y valoraciones de ejemplo">
      ejemplo
    </span>
  )
}

export function FiltersPanel({ filters, onChange }: Props) {
  const [open, setOpen] = useState(true)
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  return (
    <section className="filters">
      <button
        type="button"
        className="filters-header"
        aria-expanded={open}
        aria-controls="filters-body"
        onClick={() => setOpen(!open)}
      >
        <h2>Filtros</h2>
        <ChevronDownIcon className="chevron" />
      </button>
      {open && (
        <div id="filters-body" className="filters-body">
          <div className="filter-row">
            <SunIcon className="filter-icon sun" />
            <span>Con sol ahora</span>
            <Toggle
              label="Con sol ahora"
              checked={filters.sunNow}
              onChange={(sunNow) => set({ sunNow })}
            />
          </div>
          <label className="filter-row">
            <BeerIcon className="filter-icon" />
            <span>
              Precio de la caña <DemoTag />
            </span>
            <select
              value={filters.maxPriceCents?.toString() ?? ''}
              onChange={(event) =>
                set({
                  maxPriceCents:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                })
              }
            >
              {PRICE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-row">
            <StarOutlineIcon className="filter-icon" />
            <span>
              Valoración mínima <DemoTag />
            </span>
            <select
              value={filters.minRating?.toString() ?? ''}
              onChange={(event) =>
                set({
                  minRating:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                })
              }
            >
              {RATING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-row">
            <TerraceIcon className="filter-icon" />
            <span>Solo con terraza</span>
            <Toggle
              label="Solo con terraza"
              checked={filters.onlyTerrace}
              onChange={(onlyTerrace) => set({ onlyTerrace })}
            />
          </div>
        </div>
      )}
    </section>
  )
}
