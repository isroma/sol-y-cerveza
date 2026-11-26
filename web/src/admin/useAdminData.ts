import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadTerraces, type LatLon, type Terrace } from '../data/terraces.ts'
import { ADMIN_ENDPOINTS } from './endpoints.ts'
import { priceKey, venuePriceSchema, type VenuePrice } from './pricesCsv.ts'
import {
  proposalKey,
  proposalsResponseSchema,
  type Proposal,
  type ProposalsResponse,
} from './proposals.ts'
import {
  ADDED_PREFIX,
  nextReview,
  reviewSchema,
  type Review,
  type Status,
} from './review.ts'
import { today } from './today.ts'
import {
  trustById,
  trustResponseSchema,
  type Trust,
  type TrustResponse,
} from './trust.ts'

export const NO_PROPOSALS: ProposalsResponse = {
  proposals: [],
  ignored: [],
  errors: [],
}

/** A change to the selected venue's review row (see nextReview). */
export type ReviewChange =
  | { kind: 'status'; status: Status }
  | { kind: 'terrace'; at: LatLon }
  | { kind: 'venue'; at: LatLon }
  | { kind: 'looksRight' }

/** A venue added in the admin view, shaped like a dataset record. */
function addedVenue(review: Review): Terrace | null {
  if (!review.venueId.startsWith(ADDED_PREFIX)) return null
  if (!review.name || !review.kind || !review.venue) return null
  return {
    id: review.venueId,
    name: review.name,
    kind: review.kind,
    venue: review.venue,
    terrace: null,
    sources: ['review'],
    verified: null,
    horizon: null,
  }
}

async function fetchPrices(): Promise<Map<string, VenuePrice>> {
  const response = await fetch(ADMIN_ENDPOINTS.prices)
  if (!response.ok)
    throw new Error(`GET ${ADMIN_ENDPOINTS.prices}: HTTP ${response.status}`)
  const rows = venuePriceSchema.array().parse(await response.json())
  return new Map(rows.map((p) => [priceKey(p), p]))
}

/** The machine proposals; none when the file or the endpoint is missing. */
async function fetchProposals(): Promise<ProposalsResponse> {
  const response = await fetch(ADMIN_ENDPOINTS.proposals)
  if (!response.ok)
    throw new Error(`GET ${ADMIN_ENDPOINTS.proposals}: HTTP ${response.status}`)
  return proposalsResponseSchema.parse(await response.json())
}

async function fetchTrust(): Promise<TrustResponse> {
  const response = await fetch(ADMIN_ENDPOINTS.trust)
  if (!response.ok)
    throw new Error(`GET ${ADMIN_ENDPOINTS.trust}: HTTP ${response.status}`)
  return trustResponseSchema.parse(await response.json())
}

async function fetchReviews(): Promise<Map<string, Review>> {
  const response = await fetch(ADMIN_ENDPOINTS.review)
  if (!response.ok)
    throw new Error(`GET ${ADMIN_ENDPOINTS.review}: HTTP ${response.status}`)
  const rows = reviewSchema.array().parse(await response.json())
  return new Map(rows.map((r) => [r.venueId, r]))
}

/**
 * The admin's data: terraces.json, the review rows, the prices and the
 * machine proposals, loaded once, and the writes back to the dev server.
 * Writes show at once; on a failed write the file's rows come back.
 * `change` applies to the venue `selectedId` names.
 */
export function useAdminData(selectedId: string | null) {
  const [dataVenues, setVenues] = useState<Terrace[]>([])
  // Records of terraces.json this client can't read, so not on the map.
  const [dropped, setDropped] = useState(0)
  const [reviews, setReviews] = useState(new Map<string, Review>())
  const [prices, setPrices] = useState(new Map<string, VenuePrice>())
  const [message, setMessage] = useState('Loading…')
  const [proposalData, setProposalData] =
    useState<ProposalsResponse>(NO_PROPOSALS)
  // Trust tiers of Overture venues (trust.ts); none until the file exists.
  const [trust, setTrust] = useState<ReadonlyMap<string, Trust>>(new Map())
  const [trustMissing, setTrustMissing] = useState(false)

  useEffect(() => {
    Promise.all([loadTerraces(), fetchReviews(), fetchPrices()])
      .then(([{ file, dropped }, rows, priceRows]) => {
        setVenues(file.terraces)
        setDropped(dropped)
        setReviews(rows)
        setPrices(priceRows)
        setMessage('')
      })
      .catch((error: unknown) => setMessage(String(error)))
    fetchProposals()
      .then(setProposalData)
      .catch((error: unknown) =>
        setMessage(`Machine proposals unavailable: ${String(error)}`),
      )
    fetchTrust()
      .then(({ venues, missing }) => {
        setTrust(trustById(venues))
        setTrustMissing(missing)
      })
      .catch((error: unknown) =>
        setMessage(`Trust tiers unavailable: ${String(error)}`),
      )
  }, [])

  const venues = useMemo(
    () =>
      [
        ...dataVenues,
        ...[...reviews.values()].flatMap((r) => addedVenue(r) ?? []),
      ].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [dataVenues, reviews],
  )

  // Rows show at once; on a failed write the file's rows come back.
  const saveAll = useCallback(
    async (changes: readonly { venueId: string; next: Review | null }[]) => {
      setReviews((current) => {
        const copy = new Map(current)
        for (const { venueId, next } of changes) {
          if (next) copy.set(venueId, next)
          else copy.delete(venueId)
        }
        return copy
      })
      try {
        for (const { venueId, next } of changes) {
          const response = next
            ? await fetch(ADMIN_ENDPOINTS.review, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(next),
              })
            : await fetch(
                `${ADMIN_ENDPOINTS.review}?venue_id=${encodeURIComponent(venueId)}`,
                {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                },
              )
          if (!response.ok) throw new Error(await response.text())
        }
        setMessage('Saved')
        return true
      } catch (error) {
        setMessage(`Not saved: ${String(error)}`)
        setReviews(await fetchReviews())
        return false
      }
    },
    [],
  )

  const save = useCallback(
    async (venueId: string, next: Review | null) => {
      return await saveAll([{ venueId, next }])
    },
    [saveAll],
  )

  const savePrice = useCallback(
    async (key: string, next: VenuePrice | null) => {
      setPrices((current) => {
        const copy = new Map(current)
        if (next) copy.set(key, next)
        else copy.delete(key)
        return copy
      })
      try {
        const response = next
          ? await fetch(ADMIN_ENDPOINTS.prices, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(next),
            })
          : await fetch(
              `${ADMIN_ENDPOINTS.prices}?key=${encodeURIComponent(key)}`,
              {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
              },
            )
        if (!response.ok) throw new Error(await response.text())
        setMessage('Saved')
      } catch (error) {
        setMessage(`Not saved: ${String(error)}`)
        setPrices(await fetchPrices())
      }
    },
    [],
  )

  const change = useCallback(
    (change: ReviewChange) => {
      if (!selectedId) return
      if (
        change.kind === 'status' &&
        change.status === 'not_venue' &&
        selectedId.startsWith(ADDED_PREFIX)
      )
        return
      void save(
        selectedId,
        nextReview(reviews.get(selectedId), selectedId, change, today()),
      )
    },
    [save, selectedId, reviews],
  )

  const ignoreProposal = useCallback(async (p: Proposal) => {
    const key = proposalKey(p)
    setProposalData((current) => ({
      ...current,
      ignored: [...current.ignored, key],
    }))
    try {
      const response = await fetch(ADMIN_ENDPOINTS.proposals, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      if (!response.ok) throw new Error(await response.text())
      setMessage('Proposal ignored')
    } catch (error) {
      setMessage(`Not saved: ${String(error)}`)
      setProposalData(await fetchProposals().catch(() => NO_PROPOSALS))
    }
  }, [])

  return {
    dataVenues,
    dropped,
    venues,
    reviews,
    prices,
    message,
    setMessage,
    proposalData,
    trust,
    trustMissing,
    saveAll,
    save,
    savePrice,
    change,
    ignoreProposal,
  }
}
