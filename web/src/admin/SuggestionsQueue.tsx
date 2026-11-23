import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { BRAND_NAMES, BRANDS, formatCents, ITEMS } from '../data/prices.ts'

const API = '/__admin/suggestions'

const groupSchema = z.object({
  venue_id: z.string(),
  item: z.enum(ITEMS),
  brand: z.string(),
  cents: z.number().int(),
  voters: z.number().int(),
  last: z.string(),
})
export type SuggestionGroup = z.infer<typeof groupSchema>

async function fetchQueue(): Promise<{
  groups: SuggestionGroup[] | null
  error: string | null
}> {
  try {
    const response = await fetch(API)
    const body: unknown = await response.json()
    if (!response.ok) {
      const parsed = z.object({ error: z.string() }).safeParse(body)
      return {
        groups: null,
        error: parsed.success ? parsed.data.error : `HTTP ${response.status}`,
      }
    }
    const parsed = z.object({ suggestions: z.array(groupSchema) }).parse(body)
    return { groups: parsed.suggestions, error: null }
  } catch (e) {
    return { groups: null, error: String(e) }
  }
}

type Props = {
  nameOf: (venueId: string) => string
  onSelect: (venueId: string) => void
  /** Accepting saves the price as a curator price, then marks it resolved. */
  onAccept: (group: SuggestionGroup) => Promise<void>
}

/** Pending visitor suggestions from the API, to accept or reject. */
export function SuggestionsQueue({ nameOf, onSelect, onAccept }: Props) {
  const [groups, setGroups] = useState<SuggestionGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await fetchQueue()
    setGroups(result.groups)
    setError(result.error)
  }, [])

  useEffect(() => {
    let live = true
    void fetchQueue().then((result) => {
      if (!live) return
      setGroups(result.groups)
      setError(result.error)
    })
    return () => {
      live = false
    }
  }, [])

  const resolve = async (
    group: SuggestionGroup,
    status: 'accepted' | 'rejected',
  ) => {
    if (status === 'accepted') await onAccept(group)
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venueId: group.venue_id,
        item: group.item,
        brand: group.brand || null,
        cents: group.cents,
        status,
      }),
    })
    await load()
  }

  if (error)
    return <p className="admin-help">Suggestions unavailable: {error}</p>
  if (!groups) return <p className="admin-help">Loading suggestions…</p>
  if (groups.length === 0)
    return <p className="admin-help">No pending suggestions.</p>
  return (
    <ol className="admin-queue">
      {groups.map((g) => {
        const brand = BRANDS.find((b) => b === g.brand)
        return (
          <li key={`${g.venue_id}|${g.item}|${g.brand}|${g.cents}`}>
            <button
              type="button"
              className="admin-queue-venue"
              onClick={() => onSelect(g.venue_id)}
            >
              {nameOf(g.venue_id)}
            </button>
            <span>
              {g.item === 'cana'
                ? 'Caña'
                : `Tercio ${brand ? BRAND_NAMES[brand] : g.brand}`}{' '}
              <strong>{formatCents(g.cents)}</strong> · {g.voters}{' '}
              {g.voters === 1 ? 'person' : 'people'}
            </span>
            <span className="admin-actions">
              <button type="button" onClick={() => void resolve(g, 'accepted')}>
                Accept
              </button>
              <button type="button" onClick={() => void resolve(g, 'rejected')}>
                Reject
              </button>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
