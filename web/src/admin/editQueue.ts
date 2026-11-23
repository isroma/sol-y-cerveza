import { z } from 'zod'
import { venuePriceSchema, type VenuePrice } from './pricesCsv.ts'
import { reviewSchema, type Review } from './review.ts'

/**
 * The admin's offline edit queue. A save that cannot reach the dev server is
 * kept (in localStorage, by the caller) and sent again later, in order. Pure:
 * no fetch, no storage of its own.
 */
export const REVIEW_API = '/__admin/review'
export const PRICES_API = '/__admin/prices'
export const QUEUE_STORAGE_KEY = 'solycerveza-admin-edits'

const editSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('review'),
    venueId: z.string().min(1),
    review: reviewSchema.nullable(),
    queuedAt: z.string(),
  }),
  z.object({
    kind: z.literal('price'),
    key: z.string().min(1),
    price: venuePriceSchema.nullable(),
    queuedAt: z.string(),
  }),
])

/** One save: a review or a price, written (or removed when null). */
export type Edit = z.infer<typeof editSchema>

const fileSchema = z.object({ edits: z.array(editSchema) })

export function reviewEdit(venueId: string, review: Review | null): Edit {
  return { kind: 'review', venueId, review, queuedAt: new Date().toISOString() }
}

export function priceEdit(key: string, price: VenuePrice | null): Edit {
  return { kind: 'price', key, price, queuedAt: new Date().toISOString() }
}

/** The request that applies an edit on the dev server. */
export function requestFor(edit: Edit): { url: string; init: RequestInit } {
  const json = { 'Content-Type': 'application/json' }
  if (edit.kind === 'review')
    return edit.review
      ? {
          url: REVIEW_API,
          init: {
            method: 'PUT',
            headers: json,
            body: JSON.stringify(edit.review),
          },
        }
      : {
          url: `${REVIEW_API}?venue_id=${encodeURIComponent(edit.venueId)}`,
          init: { method: 'DELETE' },
        }
  return edit.price
    ? {
        url: PRICES_API,
        init: {
          method: 'PUT',
          headers: json,
          body: JSON.stringify(edit.price),
        },
      }
    : {
        url: `${PRICES_API}?key=${encodeURIComponent(edit.key)}`,
        init: { method: 'DELETE' },
      }
}

/**
 * What an answer means for an edit. `null` is no answer (offline, server
 * down, timeout). 401/403 are kept too: the dev server was restarted with a
 * new token, and the edit goes through once the page has it. Any other 4xx is
 * an edit the server will never take, so it leaves the queue.
 */
export type Outcome = 'saved' | 'retry' | 'rejected'

export function outcomeOf(status: number | null): Outcome {
  if (status === null) return 'retry'
  if (status >= 200 && status < 300) return 'saved'
  if (status === 401 || status === 403 || status === 408 || status === 429)
    return 'retry'
  if (status >= 500) return 'retry'
  return 'rejected'
}

/** Sends one edit and returns the HTTP status, or null without an answer. */
export type Send = (edit: Edit) => Promise<number | null>

export type ReplayResult = {
  /** Edits still waiting, in order: the first one failed to go through. */
  remaining: Edit[]
  saved: Edit[]
  rejected: { edit: Edit; status: number }[]
}

/** Sends the queue in order, stopping at the first edit that has to wait. */
export async function replay(
  queue: readonly Edit[],
  send: Send,
): Promise<ReplayResult> {
  const saved: Edit[] = []
  const rejected: { edit: Edit; status: number }[] = []
  for (const [index, edit] of queue.entries()) {
    const status = await send(edit)
    const outcome = outcomeOf(status)
    if (outcome === 'retry')
      return { remaining: queue.slice(index), saved, rejected }
    if (outcome === 'saved') saved.push(edit)
    else rejected.push({ edit, status: status ?? 0 })
  }
  return { remaining: [], saved, rejected }
}

/** The local view with the waiting edits on top of what the server sent. */
export function applyEdits(
  reviews: ReadonlyMap<string, Review>,
  prices: ReadonlyMap<string, VenuePrice>,
  queue: readonly Edit[],
): { reviews: Map<string, Review>; prices: Map<string, VenuePrice> } {
  const r = new Map(reviews)
  const p = new Map(prices)
  for (const edit of queue) {
    if (edit.kind === 'review') {
      if (edit.review) r.set(edit.venueId, edit.review)
      else r.delete(edit.venueId)
    } else if (edit.price) p.set(edit.key, edit.price)
    else p.delete(edit.key)
  }
  return { reviews: r, prices: p }
}

/** The export file: also what loadQueue reads back. */
export function serializeQueue(queue: readonly Edit[]): string {
  return `${JSON.stringify({ edits: queue }, null, 2)}\n`
}

/** Parses an export file or the stored queue. Throws on anything else. */
export function parseQueue(text: string): Edit[] {
  return fileSchema.parse(JSON.parse(text)).edits
}

type QueueStorage = Pick<Storage, 'getItem'>

/** The stored queue; empty when there is none, it can't be read or is corrupt. */
export function loadQueue(storage: QueueStorage | null): Edit[] {
  try {
    const text = storage?.getItem(QUEUE_STORAGE_KEY)
    return text ? parseQueue(text) : []
  } catch {
    return []
  }
}

/** Short English description for the waiting list. */
export function describeEdit(edit: Edit, nameOf: (id: string) => string) {
  if (edit.kind === 'review') {
    const name = nameOf(edit.venueId)
    if (!edit.review) return `${name}: undo review`
    const what = edit.review.status ?? 'position or details'
    return `${name}: ${what.replace('_', ' ')}`
  }
  const [venueId = '', item = '', brand = ''] = edit.key.split('|')
  const label = brand ? `${item} ${brand}` : item
  const price = edit.price
    ? `${(edit.price.cents / 100).toFixed(2)} €`
    : 'removed'
  return `${nameOf(venueId)}: ${label} ${price}`
}
