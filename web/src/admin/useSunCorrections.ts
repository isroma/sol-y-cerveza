import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { ADMIN_ENDPOINTS } from './endpoints.ts'
import {
  acceptedSunResponseSchema,
  missingSunCorrections,
  sunCorrectionSchema,
  toSunCorrection,
} from './sunCorrectionsCsv.ts'

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  const body: unknown = await response.json()
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(body)
    throw new Error(
      parsed.success ? parsed.data.error : `HTTP ${response.status}`,
    )
  }
  return body
}

/**
 * Copies the accepted sun reports the API lists into sun_corrections.csv,
 * adding only the ids it lacks (the dev server checks again as it writes).
 * A report the CSV can't hold (e.g. a venue id the build's reader refuses)
 * is skipped and named in `skipped`, so it never blocks the others. Resolves
 * with the number of rows added, or why it failed; never rejects.
 */
export async function syncSunCorrections(): Promise<
  { added: number; skipped: number[] } | { error: string }
> {
  try {
    const accepted = acceptedSunResponseSchema.parse(
      await getJson(ADMIN_ENDPOINTS.sunAccepted),
    ).reports
    const rows = z
      .array(sunCorrectionSchema)
      .parse(await getJson(ADMIN_ENDPOINTS.sunCorrections))
    const skipped: number[] = []
    const incoming = accepted.flatMap((report) => {
      try {
        return [toSunCorrection(report)]
      } catch {
        skipped.push(report.id)
        return []
      }
    })
    const missing = missingSunCorrections(rows, incoming)
    if (missing.length === 0) return { added: 0, skipped }
    const response = await fetch(ADMIN_ENDPOINTS.sunCorrections, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: missing }),
    })
    if (!response.ok) return { error: `HTTP ${response.status}` }
    const { added } = z
      .object({ added: z.number().int() })
      .parse(await response.json())
    return { added, skipped }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Records accepted sun reports in sun_corrections.csv for Publish (issue
 * #463): once `ready` (the Inbox has loaded), and again on each `sync()`,
 * e.g. after the owner accepts a sun report. One sync at a time. A failure is
 * kept in `error` and blocks nothing else.
 */
export function useSunCorrections({
  ready,
  onAdded,
}: {
  ready: boolean
  /** Rows were added: they ship with the next Publish. */
  onAdded: (added: number) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const latest = useRef(onAdded)
  useEffect(() => {
    latest.current = onAdded
  })

  const sync = useCallback(() => {
    const next = chain.current.then(async () => {
      const result = await syncSunCorrections()
      if ('error' in result) return setError(result.error)
      setError(
        result.skipped.length > 0
          ? `accepted report${result.skipped.length === 1 ? '' : 's'} ${result.skipped.join(', ')} not recorded: not a valid sun_corrections.csv row`
          : null,
      )
      if (result.added > 0) latest.current(result.added)
    })
    chain.current = next
    return next
  }, [])

  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    void sync()
  }, [ready, sync])

  return { error, sync }
}
