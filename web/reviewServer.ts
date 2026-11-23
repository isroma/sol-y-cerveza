import { readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { publishReview } from './publish.ts'
import {
  formatReviewCsv,
  parseReviewCsv,
  removeReview,
  reviewSchema,
  upsertReview,
  type Review,
} from './src/admin/review.ts'

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
 * pipeline/data/venue_review.csv. Never part of the built site.
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
      let publishing = false
      server.middlewares.use('/__admin/publish', (req, res) => {
        if (req.method !== 'POST')
          return send(res, 405, { error: 'method not allowed' })
        if (publishing) return send(res, 409, { error: 'already publishing' })
        publishing = true
        // Waits for pending saves so the CSV is complete.
        void queue
          .then(publishReview)
          .then((result) => send(res, 200, result))
          .catch((error: unknown) => send(res, 500, { error: String(error) }))
          .finally(() => {
            publishing = false
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
