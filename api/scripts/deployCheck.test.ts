import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { decide, fingerprint, liveBuild, show, verify } from './deployCheck.ts'

const BUILD = '0123456789abcdef0123456789abcdef'
const OTHER = 'fedcba9876543210fedcba9876543210'

describe('fingerprint', () => {
  let root: string
  let api: string
  let out: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deploy-check-'))
    api = join(root, 'repo', 'api')
    out = join(root, 'out')
    await mkdir(join(api, 'migrations'), { recursive: true })
    await mkdir(join(api, 'node_modules', 'wrangler'), { recursive: true })
    await mkdir(out)
    await writeFile(join(api, 'wrangler.toml'), 'name = "x"\n')
    await writeFile(
      join(api, 'migrations', '0001_a.sql'),
      'CREATE TABLE a (x);\n',
    )
    await writeFile(
      join(api, 'node_modules', 'wrangler', 'package.json'),
      '{"version": "4.0.0"}',
    )
    await writeFile(join(out, 'index.js'), 'export default {}\n')
    await writeFile(
      join(out, 'index.js.map'),
      `{"sources":["${api}/src/index.ts"]}`,
    )
    await writeFile(join(out, 'README.md'), `generated at ${Date.now()}`)
  })

  it('is 32 hex characters and the same on every build', async () => {
    const first = await fingerprint(api, out)
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(await fingerprint(api, out)).toBe(first)
  })

  it('ignores the source map, the README and the absolute paths', async () => {
    const before = await fingerprint(api, out)
    await writeFile(join(out, 'index.js.map'), '{"sources":["/elsewhere"]}')
    await writeFile(join(out, 'README.md'), 'generated later')
    expect(await fingerprint(api, out)).toBe(before)
    const moved = await mkdtemp(join(tmpdir(), 'deploy-check-moved-'))
    await cp(root, moved, { recursive: true })
    expect(
      await fingerprint(join(moved, 'repo', 'api'), join(moved, 'out')),
    ).toBe(before)
  })

  it.each([
    [
      'the bundle',
      () => writeFile(join(out, 'index.js'), 'export default 1\n'),
    ],
    ['another module', () => writeFile(join(out, 'chunk.js'), '1\n')],
    [
      'wrangler.toml',
      () => writeFile(join(api, 'wrangler.toml'), 'name = "y"\n'),
    ],
    [
      'a new migration',
      () => writeFile(join(api, 'migrations', '0002_b.sql'), 'SELECT 1;\n'),
    ],
    [
      'a migration',
      () =>
        writeFile(
          join(api, 'migrations', '0001_a.sql'),
          'CREATE TABLE b (x);\n',
        ),
    ],
    [
      'the wrangler version',
      () =>
        writeFile(
          join(api, 'node_modules', 'wrangler', 'package.json'),
          '{"version": "4.0.1"}',
        ),
    ],
  ])('changes with %s', async (_, change) => {
    const before = await fingerprint(api, out)
    await change()
    expect(await fingerprint(api, out)).not.toBe(before)
  })

  it('changes when a migration is renamed', async () => {
    const before = await fingerprint(api, out)
    await rm(join(api, 'migrations', '0001_a.sql'))
    await writeFile(
      join(api, 'migrations', '0001_b.sql'),
      'CREATE TABLE a (x);\n',
    )
    expect(await fingerprint(api, out)).not.toBe(before)
  })

  it('refuses an output directory with no bundle', async () => {
    await rm(join(out, 'index.js'))
    await expect(fingerprint(api, out)).rejects.toThrow('no JavaScript bundle')
  })
})

/** A stand-in for the live Worker: each request gets the next answer (the last repeats). */
type Answer = { status?: number; body?: string; hang?: boolean }

describe('the live build', () => {
  let server: Server
  let base: string
  let answers: Answer[] = []
  let asked: string[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      asked.push(request.url ?? '')
      const answer = (answers.length > 1 ? answers.shift() : answers[0]) ?? {}
      if (answer.hang) return
      response.writeHead(answer.status ?? 200, {
        'Content-Type': 'application/json',
      })
      response.end(answer.body ?? '')
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('no port')
    base = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  })
  beforeEach(() => {
    answers = []
    asked = []
  })

  const quick = { timeoutMs: 300 }
  const build = (value: unknown) => ({ body: JSON.stringify({ build: value }) })

  it('asks /v1/version past any cache, with or without a trailing slash', async () => {
    answers = [build(BUILD)]
    expect(await liveBuild(`${base}/`, 300)).toEqual({ ok: true, build: BUILD })
    expect(asked[0]).toMatch(/^\/v1\/version\?at=\d+$/)
  })

  it('skips only when the live Worker runs the same build', async () => {
    answers = [build(BUILD)]
    const decision = await decide(base, BUILD, quick)
    expect(decision.deploy).toBe(false)
    expect(decision.annotation).toBe(
      `::notice::The live Worker already runs build ${BUILD}: skipped the migrations and the upload.`,
    )
  })

  it.each<[string, Answer | null, string]>([
    ['another build', build(OTHER), `build "${OTHER}"`],
    ['null', build(null), 'build null'],
    [
      'a build that is a prefix',
      build(BUILD.slice(0, 16)),
      'build "0123456789abcdef"',
    ],
    ['a number', build(42), 'build is not a string'],
    ['no build field', { body: '{"ok":true}' }, 'no build in'],
    ['an array', { body: '[]' }, 'no build in'],
    ['garbage', { body: '<html>oops</html>' }, 'not JSON'],
    ['an empty body', { body: '' }, 'not JSON'],
    [
      'a huge body',
      { body: JSON.stringify({ build: 'x'.repeat(2000) }) },
      'too long',
    ],
    ['404', { status: 404, body: '{"error":"not found"}' }, 'HTTP 404'],
    ['500 with the same build', { status: 500, ...build(BUILD) }, 'HTTP 500'],
    ['a timeout', { hang: true }, 'no answer'],
  ])('deploys on %s', async (_, answer, seen) => {
    if (answer) answers = [answer]
    const decision = await decide(base, BUILD, quick)
    expect(decision.deploy).toBe(true)
    expect(decision.annotation).toContain(seen)
    expect(decision.annotation).toContain(`Deploying build ${BUILD}`)
  })

  it('deploys when nothing listens', async () => {
    const decision = await decide('http://127.0.0.1:9', BUILD, quick)
    expect(decision.deploy).toBe(true)
    expect(decision.annotation).toContain('no answer')
  })

  it.each([undefined, ''])('deploys when the URL is %j', async (url) => {
    const decision = await decide(url, BUILD, quick)
    expect(decision.deploy).toBe(true)
    expect(decision.annotation).toContain('PRICES_API is not set')
  })

  it('refuses a malformed fingerprint rather than compare it', async () => {
    answers = [build('')]
    await expect(decide(base, '', quick)).rejects.toThrow(
      'not a build fingerprint',
    )
    await expect(verify(base, 'abc', quick)).rejects.toThrow(
      'not a build fingerprint',
    )
  })

  it('never lets an answer start a workflow command on a line of its own', async () => {
    answers = [build(`x\n::error::forged %0A`)]
    const decision = await decide(base, BUILD, quick)
    expect(decision.annotation).not.toMatch(/[\r\n]/)
    // One line, so the forged `::error::` stays inside the notice's message.
    expect(decision.annotation).toMatch(/^::notice::/)
    expect(show('a\r\nb%')).toBe('"a\\r\\nb%25"')
  })

  const noWait = {
    ...quick,
    attempts: 4,
    intervalMs: 1000,
    sleep: async () => {},
  }

  it('verifies once the new build is live', async () => {
    answers = [build(OTHER), { status: 404 }, { hang: true }, build(BUILD)]
    const result = await verify(base, BUILD, noWait)
    expect(result).toEqual({
      ok: true,
      annotation: `::notice::The live Worker runs build ${BUILD} (try 4 of 4).`,
    })
  })

  it('fails when the new build never shows, naming both builds', async () => {
    answers = [build(OTHER)]
    const slept: number[] = []
    const result = await verify(base, BUILD, {
      ...noWait,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    expect(result.ok).toBe(false)
    expect(result.annotation).toBe(
      `::error::The deploy did not take effect: expected the live Worker to report build ${BUILD} within 4 tries over 3 s; last answer: build "${OTHER}".`,
    )
    expect(slept).toEqual([1000, 1000, 1000])
  })

  it('warns, without failing, when there is no URL to verify', async () => {
    const result = await verify(undefined, BUILD, noWait)
    expect(result.ok).toBe(true)
    expect(result.annotation).toMatch(/^::warning::PRICES_API is not set/)
  })
})
