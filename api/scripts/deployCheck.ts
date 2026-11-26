/**
 * The deploy guard of .github/workflows/deploy-api.yml (CLI: deploy-check.ts).
 *
 * The live Worker reports the build it runs (GET /v1/version). A deploy is
 * skipped only when that answer equals the fingerprint of the build this
 * commit makes; every other answer (another build, null, an error, no answer,
 * no URL) deploys. After a deploy, the live Worker must report the new
 * fingerprint, or the run fails.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Hex characters kept from the sha256: 128 bits. */
export const BUILD_LENGTH = 32
const BUILD = /^[0-9a-f]{32}$/

const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex')

/** Every file under `dir`, as `/`-separated paths relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'),
    )
}

/**
 * The fingerprint of everything a deploy from `apiDir` depends on: the bundle
 * `wrangler deploy --dry-run --outdir <outDir>` wrote (not its source map,
 * which holds absolute paths, nor its README, which holds the time),
 * wrangler.toml, every file in migrations/ (name and contents) and the
 * wrangler version, which also decides how the bundle is uploaded. Secrets
 * and the BUILD_ID variable are not part of it. Independent of the absolute
 * paths of both directories.
 */
export async function fingerprint(
  apiDir: string,
  outDir: string,
): Promise<string> {
  const inputs: [label: string, content: string | Uint8Array][] = []
  const bundle = (await filesUnder(outDir)).filter(
    (file) => !file.endsWith('.map') && file !== 'README.md',
  )
  if (!bundle.some((file) => /\.m?js$/.test(file)))
    throw new Error(`no JavaScript bundle in ${outDir}`)
  for (const file of bundle)
    inputs.push([`bundle/${file}`, await readFile(join(outDir, file))])
  inputs.push(['wrangler.toml', await readFile(join(apiDir, 'wrangler.toml'))])
  for (const file of await filesUnder(join(apiDir, 'migrations')))
    inputs.push([
      `migrations/${file}`,
      await readFile(join(apiDir, 'migrations', file)),
    ])
  const wrangler: unknown = JSON.parse(
    await readFile(
      join(apiDir, 'node_modules', 'wrangler', 'package.json'),
      'utf8',
    ),
  )
  const version =
    typeof wrangler === 'object' && wrangler !== null && 'version' in wrangler
      ? wrangler.version
      : undefined
  if (typeof version !== 'string')
    throw new Error('no wrangler version in node_modules')
  inputs.push(['wrangler-version', version])

  inputs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const manifest = inputs
    .map(([label, content]) => `${sha256(content)}  ${label}\n`)
    .join('')
  return sha256(manifest).slice(0, BUILD_LENGTH)
}

export type Live =
  { ok: true; build: string | null } | { ok: false; problem: string }

type Fetch = typeof fetch

/** The largest /v1/version answer read, in characters. */
const MAX_ANSWER = 1000

/** What the live Worker at `baseUrl` says it runs; any doubt is a problem. */
export async function liveBuild(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: Fetch = fetch,
): Promise<Live> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/version?at=${Date.now()}`
  let status: number
  let text: string
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    status = response.status
    text = await response.text()
  } catch (error) {
    return { ok: false, problem: `no answer (${String(error)})` }
  }
  if (status !== 200) return { ok: false, problem: `HTTP ${status}` }
  if (text.length > MAX_ANSWER) return { ok: false, problem: 'answer too long' }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { ok: false, problem: `not JSON: ${show(text)}` }
  }
  if (typeof body !== 'object' || body === null || !('build' in body))
    return { ok: false, problem: `no build in ${show(text)}` }
  const build = body.build
  if (build !== null && typeof build !== 'string')
    return { ok: false, problem: `build is not a string: ${show(text)}` }
  return { ok: true, build }
}

/**
 * An untrusted value for a log line: JSON-quoted (no line breaks), cut short,
 * and escaped as workflow command data, so it can't start a command.
 */
export function show(value: unknown): string {
  const quoted = JSON.stringify(value) ?? String(value)
  const short = quoted.length > 80 ? `${quoted.slice(0, 80)}…` : quoted
  return short
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
}

function describeLive(live: Live): string {
  if (!live.ok) return live.problem
  return live.build === null ? 'build null' : `build ${show(live.build)}`
}

function checkBuild(build: string): void {
  if (!BUILD.test(build))
    throw new Error(`not a build fingerprint: ${show(build)}`)
}

export type Decision = { deploy: boolean; annotation: string }

/** Whether to deploy `build`: no only when the live Worker already runs it. */
export async function decide(
  baseUrl: string | undefined,
  build: string,
  options: { timeoutMs?: number; fetch?: Fetch } = {},
): Promise<Decision> {
  checkBuild(build)
  if (!baseUrl)
    return {
      deploy: true,
      annotation: `::notice::PRICES_API is not set, so the live build is unknown: deploying build ${build}.`,
    }
  const live = await liveBuild(
    baseUrl,
    options.timeoutMs ?? 10_000,
    options.fetch,
  )
  if (live.ok && live.build === build)
    return {
      deploy: false,
      annotation: `::notice::The live Worker already runs build ${build}: skipped the migrations and the upload.`,
    }
  return {
    deploy: true,
    annotation: `::notice::Deploying build ${build} (the live API answered: ${describeLive(live)}).`,
  }
}

export type Verification = { ok: boolean; annotation: string }

/**
 * Asks the live Worker for its build until it reports `build`: `attempts`
 * tries, `intervalMs` apart. Without a URL it can't check, and says so.
 */
export async function verify(
  baseUrl: string | undefined,
  build: string,
  options: {
    attempts?: number
    intervalMs?: number
    timeoutMs?: number
    fetch?: Fetch
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<Verification> {
  checkBuild(build)
  if (!baseUrl)
    return {
      ok: true,
      annotation: `::warning::PRICES_API is not set, so nothing checked that the live Worker runs build ${build}.`,
    }
  const {
    attempts = 13,
    intervalMs = 5000,
    timeoutMs = 5000,
    sleep = (ms: number) => new Promise((done) => setTimeout(done, ms)),
  } = options
  let last: Live = { ok: false, problem: 'not asked' }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await liveBuild(baseUrl, timeoutMs, options.fetch)
    if (last.ok && last.build === build)
      return {
        ok: true,
        annotation: `::notice::The live Worker runs build ${build} (try ${attempt} of ${attempts}).`,
      }
    if (attempt < attempts) await sleep(intervalMs)
  }
  return {
    ok: false,
    annotation: `::error::The deploy did not take effect: expected the live Worker to report build ${build} within ${attempts} tries over ${Math.round(((attempts - 1) * intervalMs) / 1000)} s; last answer: ${describeLive(last)}.`,
  }
}
