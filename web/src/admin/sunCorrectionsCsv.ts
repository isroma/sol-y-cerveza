import { z } from 'zod'
import { VENUE_ID } from '../data/geo.ts'

/**
 * Accepted sun and shade reports recorded for Publish (issues #463, #527), in
 * `pipeline/data/sun_corrections.csv`: one row per report, keyed by the API's
 * id; the build turns them into each terrace's `sun_corrections` (sun) and
 * `shade_corrections` (shade). A file from before #527 has no `kind` column:
 * every row is sun. The admin
 * copies them from the API's `GET /v1/admin/sun/accepted` and only ever adds
 * rows. Pure: shared by the admin page and its dev-server endpoint.
 */
export const SUN_CORRECTION_COLUMNS = [
  'id',
  'venue_id',
  'leaf_off',
  'azimuth',
  'altitude',
  'seen',
  'kind',
] as const

/** The header before shade reports (#527): no `kind`, every row sun. */
const SUN_ONLY_COLUMNS = SUN_CORRECTION_COLUMNS.slice(0, -1)

export const sunCorrectionSchema = z.object({
  /** The API's sun_reports.id. */
  id: z.number().int().positive(),
  /** As the build's reader requires (VENUE_ID mirrors the pipeline's pattern). */
  venueId: z.string().regex(VENUE_ID),
  /** The season the report was made in. */
  leafOff: z.boolean(),
  /** Degrees, 1 decimal. 360.0 is a rounded 359.95 or more: the build takes it mod 360. */
  azimuth: z.number().min(0).max(360),
  altitude: z.number().min(0).max(90),
  /** The report's instant, ISO 8601 UTC with milliseconds. */
  seen: z.iso.datetime({ precision: 3 }),
  /** Sun seen (a cap) or shade seen (a floor, ADR-0014); sun when missing (before #527). */
  kind: z.enum(['sun', 'shade']).default('sun'),
})

export type SunCorrectionRow = z.infer<typeof sunCorrectionSchema>

/** One report of the API's GET /v1/admin/sun/accepted. */
const acceptedSunSchema = z.object({
  id: z.number().int().positive(),
  venueId: z.string(),
  leafOff: z.boolean(),
  azimuth: z.number(),
  altitude: z.number(),
  at: z.string(),
  /** An API before #527 sends none: sun. */
  kind: z.enum(['sun', 'shade']).default('sun'),
})

export const acceptedSunResponseSchema = z.object({
  reports: z.array(acceptedSunSchema),
})

export type AcceptedSun = z.infer<typeof acceptedSunSchema>

/** The body the admin POSTs to the dev server: rows to add when missing. */
export const sunCorrectionsPostSchema = z.object({
  rows: z.array(sunCorrectionSchema),
})

const oneDecimal = (degrees: number) => Math.round(degrees * 10) / 10

/** An accepted report as a CSV row; throws on one the CSV can't hold. */
export function toSunCorrection(report: AcceptedSun): SunCorrectionRow {
  return sunCorrectionSchema.parse({
    id: report.id,
    venueId: report.venueId,
    leafOff: report.leafOff,
    azimuth: oneDecimal(report.azimuth),
    altitude: oneDecimal(report.altitude),
    seen: report.at,
    kind: report.kind,
  })
}

const NUMBER = /^\d+(\.\d+)?$/

export function parseSunCorrectionsCsv(text: string): SunCorrectionRow[] {
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line !== '')
  const sunOnly = header === SUN_ONLY_COLUMNS.join(',')
  if (!sunOnly && header !== SUN_CORRECTION_COLUMNS.join(',')) {
    throw new Error(
      `sun_corrections.csv: header must be ${SUN_CORRECTION_COLUMNS.join(',')}`,
    )
  }
  const width = sunOnly
    ? SUN_ONLY_COLUMNS.length
    : SUN_CORRECTION_COLUMNS.length
  const seen = new Set<number>()
  return lines.map((line, index) => {
    const where = `sun_corrections.csv:${index + 2}`
    const fields = line.split(',')
    const [id = '', venueId, leafOff, azimuth = '', altitude = '', at] = fields
    const kind = sunOnly ? 'sun' : fields[6]
    if (fields.length !== width)
      throw new Error(`${where}: expected ${width} fields`)
    if (kind !== 'sun' && kind !== 'shade')
      throw new Error(`${where}: kind must be sun or shade`)
    if (!/^\d+$/.test(id) || !NUMBER.test(azimuth) || !NUMBER.test(altitude))
      throw new Error(`${where}: id, azimuth and altitude must be numbers`)
    if (leafOff !== '0' && leafOff !== '1')
      throw new Error(`${where}: leaf_off must be 0 or 1`)
    const parsed = sunCorrectionSchema.safeParse({
      id: Number(id),
      venueId,
      leafOff: leafOff === '1',
      azimuth: Number(azimuth),
      altitude: Number(altitude),
      seen: at,
      kind,
    })
    if (!parsed.success) throw new Error(`${where}: ${parsed.error.message}`)
    if (seen.has(parsed.data.id))
      throw new Error(`${where}: id ${parsed.data.id} is there twice`)
    seen.add(parsed.data.id)
    return parsed.data
  })
}

/** Sorted by id, degrees to 1 decimal, LF and a trailing newline, so diffs stay small. */
export function formatSunCorrectionsCsv(
  rows: readonly SunCorrectionRow[],
): string {
  const lines = [...rows]
    .sort((a, b) => a.id - b.id)
    .map((r) =>
      [
        String(r.id),
        r.venueId,
        r.leafOff ? '1' : '0',
        r.azimuth.toFixed(1),
        r.altitude.toFixed(1),
        r.seen,
        r.kind,
      ].join(','),
    )
  return [SUN_CORRECTION_COLUMNS.join(','), ...lines].join('\n') + '\n'
}

/**
 * The rows of `incoming` whose id `rows` lacks (each id once). Rows already
 * there are never rewritten: the CSV is the owner's record.
 */
export function missingSunCorrections(
  rows: readonly SunCorrectionRow[],
  incoming: readonly SunCorrectionRow[],
): SunCorrectionRow[] {
  const known = new Set(rows.map((r) => r.id))
  const missing: SunCorrectionRow[] = []
  for (const row of incoming) {
    if (known.has(row.id)) continue
    known.add(row.id)
    missing.push(row)
  }
  return missing
}
