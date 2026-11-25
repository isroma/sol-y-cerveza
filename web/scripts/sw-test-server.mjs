// Test server for the service worker (e2e/offline.spec.ts): production
// builds served under /sol-y-cerveza/, like GitHub Pages, with "deploys"
// switched at runtime. Started by playwright.config.ts; by hand:
//
//   node scripts/sw-test-server.mjs [--port 5299] [--no-build]
//
// It builds three sites into node_modules/.cache/sw-test/:
//   a, b  the app with a tiny difference in the entry and map chunks, so
//         every hashed file name changes between them (two deploys);
//   kill  the kill-switch build (VITE_SW_KILL_SWITCH=1).
//
// Control endpoints (outside the site, so the worker never sees them):
//   POST /__test/deploy?site=a|b|kill    serve that build from now on
//   POST /__test/data   (JSON body)      serve this as data/terraces.json;
//                                        an empty body restores the build's
//
// data/buildings.json, data/trees.json and data/bridge-mesh.json (not in the
// build: the deploy copies them from the height-tiles branch) are the
// e2e/data/ fixtures.

import { createServer } from 'node:http'
import { readFile, rm } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(WEB, 'node_modules', '.cache', 'sw-test')
const BASE = '/sol-y-cerveza/'
const SITES = ['a', 'b', 'kill']
const LIDAR = {
  'data/buildings.json': join(WEB, 'e2e', 'data', 'buildings.json'),
  'data/trees.json': join(WEB, 'e2e', 'data', 'trees.json'),
  'data/bridge-mesh.json': join(WEB, 'e2e', 'data', 'bridge-mesh.json'),
}

const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1] || 5299)

/** Tags the entry and the map chunk, so their hashes differ per site. */
function tag(site) {
  return {
    name: 'sw-test-tag',
    transform(code, id) {
      if (id.endsWith('/src/main.tsx') || id.endsWith('/src/map/MapView.tsx'))
        return `${code}\nglobalThis.__sycTestSite = ${JSON.stringify(site)}\n`
      return null
    },
  }
}

async function buildSite(site) {
  const outDir = join(OUT, site)
  await rm(outDir, { recursive: true, force: true })
  const killSwitch = site === 'kill'
  if (killSwitch) process.env['VITE_SW_KILL_SWITCH'] = '1'
  else delete process.env['VITE_SW_KILL_SWITCH']
  // No price suggestions API, even with a local .env.local.
  process.env['VITE_PRICES_API'] = ''
  process.env['VITE_TURNSTILE_SITE_KEY'] = ''
  await build({
    root: WEB,
    logLevel: 'error',
    plugins: [tag(killSwitch ? 'b' : site)],
    build: { outDir, emptyOutDir: true },
  })
}

if (!args.includes('--no-build'))
  for (const site of SITES) await buildSite(site)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
}

let site = 'a'
let data = null

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname === '/__test/deploy' && request.method === 'POST') {
    const next = url.searchParams.get('site') ?? ''
    if (!SITES.includes(next)) return void response.writeHead(400).end()
    site = next
    return void response.writeHead(204).end()
  }
  if (url.pathname === '/__test/data' && request.method === 'POST') {
    const body = await readBody(request)
    data = body.trim() ? body : null
    return void response.writeHead(204).end()
  }
  if (url.pathname === BASE.slice(0, -1)) {
    // GitHub Pages adds the trailing slash.
    response.writeHead(301, { location: BASE })
    return void response.end()
  }
  if (!url.pathname.startsWith(BASE)) return void response.writeHead(404).end()

  let path = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html'
  if (path.endsWith('/')) path += 'index.html'
  const file = LIDAR[path] ?? normalize(join(OUT, site, path))
  if (!LIDAR[path] && !file.startsWith(join(OUT, site)))
    return void response.writeHead(404).end()
  // GitHub Pages sends a 10 minute max-age on everything.
  const headers = { 'cache-control': 'max-age=600' }
  try {
    const body =
      path === 'data/terraces.json' && data !== null
        ? data
        : await readFile(file)
    response.writeHead(200, {
      ...headers,
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    response.writeHead(404, { ...headers, 'content-type': 'text/html' })
    response.end('<!doctype html><title>404</title>')
  }
})

server.listen(port, () => {
  process.stdout.write(`sw test server: http://localhost:${port}${BASE}\n`)
})
