import { useState } from 'react'
import { isStrong, JUNK_LABELS, type JunkItem } from './junk.ts'

type Props = {
  items: readonly JunkItem[]
  onSelect: (venueId: string) => void
  /** Stages the ids; the admin saves them after a short undo window. */
  onMark: (venueIds: string[]) => void
}

/**
 * Overture-only venues that are likely not a bar or restaurant (junk.ts),
 * to mark as "not a venue" in one go. Strong signals start ticked.
 */
export function BatchDismiss({ items, onSelect, onMark }: Props) {
  // Ticks the owner changed; the rest follow the signal strength.
  const [changed, setChanged] = useState(new Map<string, boolean>())
  const ticked = (item: JunkItem) =>
    changed.get(item.venue.id) ?? isStrong(item.signals)
  const chosen = items.filter(ticked).map((item) => item.venue.id)

  const setAll = (value: boolean) =>
    setChanged(new Map(items.map((item) => [item.venue.id, value])))

  return (
    <section className="admin-candidates" aria-label="Likely not a venue">
      <h2>Likely not a venue ({items.length})</h2>
      <p className="admin-help">
        Overture-only, unreviewed. terraces.json has no Overture category or
        confidence, so these come from the name, duplicates and the distance to
        other venues. Strong signals are ticked; check the rest on the map.
      </p>
      {items.length > 0 && (
        <>
          <div className="admin-actions">
            <button
              type="button"
              className="admin-primary"
              disabled={chosen.length === 0}
              onClick={() => {
                onMark(chosen)
                setChanged(new Map())
              }}
            >
              Mark {chosen.length} as not a venue
            </button>
            <button type="button" onClick={() => setAll(true)}>
              All
            </button>
            <button type="button" onClick={() => setAll(false)}>
              None
            </button>
          </div>
          <ol className="admin-queue admin-junk">
            {items.map((item) => (
              <li key={item.venue.id}>
                <label className="admin-junk-row">
                  <input
                    type="checkbox"
                    checked={ticked(item)}
                    onChange={(e) =>
                      setChanged(
                        new Map(changed).set(item.venue.id, e.target.checked),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="admin-queue-venue"
                    onClick={() => onSelect(item.venue.id)}
                  >
                    {item.venue.name}
                  </button>
                  <span className="admin-kind">{item.venue.kind}</span>
                </label>
                <span className="admin-candidate-source">
                  {item.signals.map((s) => JUNK_LABELS[s]).join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
