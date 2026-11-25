import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { BRAND_NAMES, formatCents } from '../data/prices.ts'
import type { VenuePrice } from './pricesCsv.ts'
import {
  candidateKey,
  candidatesResponseSchema,
  toPrice,
  type Candidate,
  type CandidatesResponse,
} from './priceCandidates.ts'
import { ADMIN_ENDPOINTS } from './endpoints.ts'

async function fetchCandidates(): Promise<{
  data: CandidatesResponse | null
  error: string | null
}> {
  try {
    const response = await fetch(ADMIN_ENDPOINTS.priceCandidates)
    const body: unknown = await response.json()
    if (!response.ok) {
      const parsed = z.object({ error: z.string() }).safeParse(body)
      return {
        data: null,
        error: parsed.success ? parsed.data.error : `HTTP ${response.status}`,
      }
    }
    return { data: candidatesResponseSchema.parse(body), error: null }
  } catch (e) {
    return { data: null, error: String(e) }
  }
}

function hostOf(url: string): string {
  return new URL(url).host.replace(/^www\./, '')
}

function fileOf(url: string): string {
  const name = new URL(url).pathname.split('/').pop() ?? ''
  return name ? decodeURIComponent(name) : hostOf(url)
}

function label(c: Candidate): string {
  return c.item === 'cana' || !c.brand
    ? 'Caña'
    : `Tercio ${BRAND_NAMES[c.brand]}`
}

type Props = {
  nameOf: (venueId: string) => string
  onSelect: (venueId: string) => void
  /** Saves the price in venue_prices.csv (the admin's usual save path). */
  onAccept: (price: VenuePrice) => Promise<void>
}

/**
 * Prices read on venues' own websites (`python -m solycerveza.price_candidates`,
 * ADR-0006), to accept into venue_prices.csv or dismiss. Decisions are kept
 * in price_candidates.csv, so a candidate never comes back.
 */
export function PriceCandidates({ nameOf, onSelect, onAccept }: Props) {
  const [data, setData] = useState<CandidatesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await fetchCandidates()
    setData(result.data)
    setError(result.error)
  }, [])

  useEffect(() => {
    let live = true
    void fetchCandidates().then((result) => {
      if (!live) return
      setData(result.data)
      setError(result.error)
    })
    return () => {
      live = false
    }
  }, [])

  const decide = async (c: Candidate, status: 'accepted' | 'dismissed') => {
    try {
      if (status === 'accepted') await onAccept(toPrice(c))
      const response = await fetch(ADMIN_ENDPOINTS.priceCandidates, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: candidateKey(c), status }),
      })
      if (!response.ok) setError(await response.text())
    } catch (e) {
      setError(String(e))
    }
    await load()
  }

  if (error)
    return <p className="admin-help">Website prices unavailable: {error}</p>
  if (!data) return <p className="admin-help">Loading website prices…</p>
  const pending = data.candidates.filter((c) => c.status === 'pending')
  return (
    <section className="admin-candidates" aria-label="Website price candidates">
      <h2>Website price candidates ({pending.length})</h2>
      {pending.length === 0 ? (
        <p className="admin-help">
          None pending. Run{' '}
          <code>uv run python -m solycerveza.price_candidates</code> in{' '}
          <code>pipeline/</code> to look for more.
        </p>
      ) : (
        <ol className="admin-queue">
          {pending.map((c) => (
            <li key={candidateKey(c)}>
              <button
                type="button"
                className="admin-queue-venue"
                onClick={() => onSelect(c.venueId)}
              >
                {nameOf(c.venueId)}
              </button>
              <span>
                {label(c)} <strong>{formatCents(c.cents)}</strong>
              </span>
              <q className="admin-candidate-snippet">{c.snippet}</q>
              <span className="admin-candidate-source">
                <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                  {hostOf(c.sourceUrl)}
                </a>{' '}
                · fetched {c.fetched}
              </span>
              <span className="admin-actions">
                <button
                  type="button"
                  onClick={() => void decide(c, 'accepted')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => void decide(c, 'dismissed')}
                >
                  Dismiss
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {data.leads.length > 0 && (
        <details className="admin-help">
          <summary>
            Menus as PDF or image, to read by hand ({data.leads.length})
          </summary>
          <ul className="admin-candidate-leads">
            {data.leads.map((lead) => (
              <li key={`${lead.venueId}|${lead.url}`}>
                <button
                  type="button"
                  className="admin-queue-venue"
                  onClick={() => onSelect(lead.venueId)}
                >
                  {nameOf(lead.venueId)}
                </button>{' '}
                <a href={lead.url} target="_blank" rel="noreferrer">
                  {fileOf(lead.url)}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
