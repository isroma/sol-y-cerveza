import type { LatLon } from '../data/terraces.ts'
import { cleanName, KINDS, type Kind } from './review.ts'

/** A venue being added in the admin view, before it is saved. */
export type Adding = { name: string; kind: Kind; at: LatLon | null }

type Props = {
  adding: Adding
  onChange: (adding: Adding) => void
  onSave: () => void
  onCancel: () => void
}

/** The panel to add a venue no source lists (a `review:` venue). */
export function AddVenuePanel({ adding, onChange, onSave, onCancel }: Props) {
  return (
    <section className="admin-panel" aria-label="Add a venue">
      <h2>Add a venue</h2>
      <p className="admin-help">
        For a bar or restaurant that is missing from the list. Click the map
        where it is, then name it.
      </p>
      <label className="admin-field">
        Name
        <input
          autoFocus
          value={adding.name}
          onChange={(e) => onChange({ ...adding, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave()
            if (e.key === 'Escape') onCancel()
          }}
        />
      </label>
      <label className="admin-field">
        Kind
        <select
          value={adding.kind}
          onChange={(e) => {
            const kind = KINDS.find((k) => k === e.target.value)
            if (kind) onChange({ ...adding, kind })
          }}
        >
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <p className="admin-meta">
        {adding.at
          ? 'Placed. Drag the pin or click again to adjust.'
          : 'Not placed yet: click the map.'}
      </p>
      <div className="admin-actions">
        <button
          type="button"
          disabled={!adding.at || !cleanName(adding.name)}
          onClick={onSave}
        >
          Save venue
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}
