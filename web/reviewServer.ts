import { spawn } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, type Plugin } from 'vite'
import {
  answerPhoto,
  claudeReader,
  PHOTO_MAX_BODY,
  photoStatus,
  readJsonCapped,
} from './pricePhotoServer.ts'
import { publishStatus, startPublish } from './publish.ts'
import {
  formatReviewCsv,
  parseReviewCsv,
  removeReview,
  reviewSchema,
  upsertReview,
  type Review,
} from './src/admin/review.ts'
import {
  isLoopbackHost,
  newToken,
  tokenAccepted,
  TOKEN_HEADER,
  TOKEN_PARAM,
} from './src/admin/lanToken.ts'
import {
  parseProbeOutput,
  parseProbeQuery,
  type Position,
  type ProbeOutput,
} from './src/admin/probe.ts'
import {
  formatPricesCsv,
  parsePricesCsv,
  removePrice,
  upsertPrice,
  venuePriceSchema,
  type VenuePrice,
} from './src/admin/pricesCsv.ts'
import {
  decide,
  decisionSchema,
  formatCandidatesCsv,
  parseCandidatesCsv,
  parseLeadsCsv,
  type Candidate,
  type Lead,
} from './src/admin/priceCandidates.ts'

const CSV = fileURLToPath(
  new URL('../pipeline/data/venue_review.csv', import.meta.url),
)

async function readReviews(): Promise<Review[]> {
  try {
    return parseReviewCsv(await readFile(CSV, 'utf-8'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return []
    throw error
  }
}

async function writeReviews(reviews: readonly Review[]): Promise<void> {
  const partial = `${CSV}.part`
  await writeFile(partial, formatReviewCsv(reviews), 'utf-8')
  await rename(partial, CSV)
}

const PRICES_CSV = fileURLToPath(
  new URL('../pipeline/data/venue_prices.csv', import.meta.url),
)

async function readPrices(): Promise<VenuePrice[]> {
  try {
    return parsePricesCsv(await readFile(PRICES_CSV, 'utf-8'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return []
    throw error
  }
}

async function writePrices(prices: readonly VenuePrice[]): Promise<void> {
  const partial = `${PRICES_CSV}.part`
  await writeFile(partial, formatPricesCsv(prices), 'utf-8')
  await rename(partial, PRICES_CSV)
}

// Written by `python -m solycerveza.price_candidates` (ADR-0006).
const CANDIDATES_CSV = fileURLToPath(
  new URL('../pipeline/data/price_candidates.csv', import.meta.url),
)
const LEADS_CSV = fileURLToPath(
  new URL('../pipeline/.cache/menu_leads.csv', import.meta.url),
)

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null
    throw error
  }
}

async function readCandidates(): Promise<Candidate[]> {
  const text = await readOptional(CANDIDATES_CSV)
  return text === null ? [] : parseCandidatesCsv(text)
}

async function readLeads(): Promise<Lead[]> {
  const text = await readOptional(LEADS_CSV)
  return text === null ? [] : parseLeadsCsv(text)
}

async function writeCandidates(candidates: readonly Candidate[]) {
  const partial = `${CANDIDATES_CSV}.part`
  await writeFile(partial, formatCandidatesCsv(candidates), 'utf-8')
  await rename(partial, CANDIDATES_CSV)
}

const PIPELINE = fileURLToPath(new URL('../pipeline/', import.meta.url))
const PROBE_TIMEOUT_MS = 60_000

/** Optional raster paths for the probe (absolute, or relative to web/). */
type Rasters = { dsm: string; dtm: string }

/**
 * Runs `python -m solycerveza.probe` for one position, without a shell.
 * Resolves with the HTTP status and body for the admin; never rejects.
 */
function runProbe(
  at: Position,
  rasters: Rasters,
  signal: AbortSignal,
): Promise<{ status: number; body: ProbeOutput }> {
  const args = ['run', '--quiet', 'python', '-m', 'solycerveza.probe']
  args.push('--lat', at.lat.toFixed(5), '--lon', at.lon.toFixed(5))
  if (rasters.dsm) args.push('--dsm', resolve(rasters.dsm))
  if (rasters.dtm) args.push('--dtm', resolve(rasters.dtm))
  return new Promise((done) => {
    const child = spawn('uv', args, {
      cwd: PIPELINE,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PROBE_TIMEOUT_MS,
      signal,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf-8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf-8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      const message =
        error.code === 'ENOENT'
          ? 'uv not found: install it (https://docs.astral.sh/uv/) to preview the sun'
          : `the probe could not run: ${error.message}`
      done({ status: 500, body: { error: message } })
    })
    child.on('close', (code, killedBy) => {
      if (killedBy && !signal.aborted) {
        const seconds = PROBE_TIMEOUT_MS / 1000
        return done({
          status: 504,
          body: { error: `the probe took longer than ${seconds} s` },
        })
      }
      const output = parseProbeOutput(stdout)
      if (output === null) {
        const last = stderr.trim().split('\n').at(-1) ?? ''
        return done({
          status: 500,
          body: { error: `the probe failed (exit ${code}): ${last}` },
        })
      }
      if ('error' in output)
        return done({
          status: output.missing_rasters ? 503 : 422,
          body: output,
        })
      done({ status: 200, body: output })
    })
  })
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

/**
 * Dev-server only: lets the admin page (admin.html) read and write
 * pipeline/data/venue_review.csv and venue_prices.csv, decide on website
 * price candidates (price_candidates.csv), probe the sun at a pin
 * (`python -m solycerveza.probe`) and read prices from a photo
 * (pricePhotoServer.ts). Never part of the built site.
 */
export function reviewServer(): Plugin {
  // Writes run one after another so two quick clicks never lose a row.
  let queue: Promise<unknown> = Promise.resolve()
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET') return send(res, 200, await readReviews())
    if (req.method === 'PUT') {
      const review = reviewSchema.parse(await body(req))
      await writeReviews(upsertReview(await readReviews(), review))
      return send(res, 200, review)
    }
    if (req.method === 'DELETE') {
      const venueId = url.searchParams.get('venue_id') ?? ''
      await writeReviews(removeReview(await readReviews(), venueId))
      return send(res, 200, { venueId })
    }
    send(res, 405, { error: 'method not allowed' })
  }
  return {
    name: 'venue-review',
    apply: 'serve',
    configureServer(server) {
      // LAN mode (`npm run admin:lan`, i.e. --host): the write and publish
      // endpoints are reachable from the network, so every /__admin request
      // needs this run's token. Localhost mode needs none.
      const lan = !isLoopbackHost(server.config.server.host)
      const token = lan ? newToken() : null
      server.middlewares.use('/__admin', (req, res, next) => {
        if (tokenAccepted(token, req.headers[TOKEN_HEADER])) return next()
        send(res, 401, {
          error:
            'LAN mode: open the admin URL with the token printed by npm run admin:lan',
        })
      })
      if (token) {
        const printUrls = server.printUrls.bind(server)
        server.printUrls = () => {
          printUrls()
          const urls = [
            ...(server.resolvedUrls?.network ?? []),
            ...(server.resolvedUrls?.local ?? []),
          ]
          const links = urls.map(
            (url) => `    ${url}admin.html?${TOKEN_PARAM}=${token}`,
          )
          server.config.logger.info(
            [
              '',
              '  Admin on your phone (same Wi-Fi), token for this run only:',
              ...links,
              ...(server.config.server.https
                ? [
                    '  The certificate is self-signed: accept the browser warning on the phone.',
                  ]
                : []),
              '',
            ].join('\n'),
          )
        }
      }
      server.middlewares.use('/__admin/publish', (req, res) => {
        if (req.method === 'GET') return send(res, 200, publishStatus())
        if (req.method !== 'POST')
          return send(res, 405, { error: 'method not allowed' })
        // Waits for pending saves so the snapshot of the CSV is complete.
        void queue.then(() =>
          startPublish()
            ? send(res, 202, publishStatus())
            : send(res, 409, { error: 'a Publish is still building' }),
        )
      })
      // The suggestions review queue, proxied to the API so the admin token
      // (PRICES_ADMIN_TOKEN in web/.env.local) never reaches the browser.
      const env = loadEnv(
        server.config.mode,
        server.config.envDir || process.cwd(),
        '',
      )
      const api = env['VITE_PRICES_API'] ?? ''
      const apiToken = env['PRICES_ADMIN_TOKEN'] ?? ''
      server.middlewares.use('/__admin/suggestions', (req, res) => {
        if (!api || !apiToken)
          return send(res, 503, {
            error:
              'set VITE_PRICES_API and PRICES_ADMIN_TOKEN in web/.env.local',
          })
        const forward = async () => {
          const path =
            req.method === 'POST'
              ? '/v1/admin/resolve'
              : '/v1/admin/suggestions'
          const init: RequestInit = {
            method: req.method === 'POST' ? 'POST' : 'GET',
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
          }
          if (req.method === 'POST') init.body = JSON.stringify(await body(req))
          const response = await fetch(`${api}${path}`, init)
          send(res, response.status, await response.json())
        }
        forward().catch((error: unknown) =>
          send(res, 502, { error: String(error) }),
        )
      })
      // Sun preview: the horizon and height above ground at a pin, from the
      // LiDAR rasters. PROBE_DSM and PROBE_DTM (e.g. in web/.env.local)
      // override the rasters in pipeline/.cache/.
      const rasters = {
        dsm: env['PROBE_DSM'] ?? '',
        dtm: env['PROBE_DTM'] ?? '',
      }
      server.middlewares.use('/__admin/probe', (req, res) => {
        if (req.method !== 'GET')
          return send(res, 405, { error: 'method not allowed' })
        const url = new URL(req.url ?? '/', 'http://localhost')
        const query = parseProbeQuery(url.searchParams)
        if (!query.ok) return send(res, 400, { error: query.error })
        // A newer position supersedes this one: the admin aborts the request.
        const abort = new AbortController()
        res.on('close', () => {
          if (!res.writableFinished) abort.abort()
        })
        void runProbe(query.at, rasters, abort.signal).then(
          ({ status, body }) => {
            if (!abort.signal.aborted) send(res, status, body)
          },
        )
      })
      // Prices from a photo of the price board, read by the Claude API with
      // ANTHROPIC_API_KEY (web/.env.local). Before /__admin/prices, which
      // would otherwise match this path too.
      const anthropicKey = env['ANTHROPIC_API_KEY'] ?? ''
      server.middlewares.use('/__admin/prices/photo', (req, res) => {
        if (req.method === 'GET')
          return send(res, 200, photoStatus(anthropicKey))
        if (req.method !== 'POST')
          return send(res, 405, { error: 'method not allowed' })
        void readJsonCapped(req, PHOTO_MAX_BODY).then(async (read) => {
          if (!read.ok)
            return send(res, read.status, {
              error:
                read.status === 413
                  ? 'the photo is larger than 5 MB'
                  : 'not JSON',
            })
          const answer = await answerPhoto(
            read.json,
            anthropicKey,
            claudeReader(anthropicKey),
          )
          send(res, answer.status, answer.body)
        })
      })
      server.middlewares.use('/__admin/prices', (req, res) => {
        const run = queue.then(async () => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (req.method === 'GET') return send(res, 200, await readPrices())
          if (req.method === 'PUT') {
            const price = venuePriceSchema.parse(await body(req))
            await writePrices(upsertPrice(await readPrices(), price))
            return send(res, 200, price)
          }
          if (req.method === 'DELETE') {
            const key = url.searchParams.get('key') ?? ''
            await writePrices(removePrice(await readPrices(), key))
            return send(res, 200, { key })
          }
          send(res, 405, { error: 'method not allowed' })
        })
        queue = run.catch((error: unknown) => {
          send(res, 400, { error: String(error) })
        })
      })
      // Website price candidates: read them, and record accept or dismiss.
      server.middlewares.use('/__admin/price-candidates', (req, res) => {
        const run = queue.then(async () => {
          if (req.method === 'GET')
            return send(res, 200, {
              candidates: await readCandidates(),
              leads: await readLeads(),
            })
          if (req.method === 'POST') {
            const decision = decisionSchema.parse(await body(req))
            await writeCandidates(decide(await readCandidates(), decision))
            return send(res, 200, decision)
          }
          send(res, 405, { error: 'method not allowed' })
        })
        queue = run.catch((error: unknown) => {
          send(res, 400, { error: String(error) })
        })
      })
      server.middlewares.use('/__admin/review', (req, res) => {
        const run = queue.then(() => handle(req, res))
        queue = run.catch((error: unknown) => {
          send(res, 400, { error: String(error) })
        })
      })
    },
  }
}
