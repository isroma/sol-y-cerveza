import { useState } from 'react'
import type { Filters } from '../filters/filters.ts'
import { track } from '../telemetry.ts'
import { FILTER_KEYS } from '../data/telemetryEvents.ts'
import { ChevronDownIcon, SunIcon, TerraceIcon } from './icons.tsx'
import { Toggle } from './Toggle.tsx'

type Props = { filters: Filters; onChange: (filters: Filters) => void }

export function FiltersPanel({ filters, onChange }: Props) {
  const [open, setOpen] = useState(true)
  const set = (patch: Partial<Filters>) => {
    for (const key of FILTER_KEYS) if (patch[key]) track('filter', key)
    onChange({ ...filters, ...patch })
  }

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
