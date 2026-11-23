// Regenerates the app icons for the web manifest and the link preview image
// (docs/design/README.md §11) from public/favicon.svg, by rendering small HTML
// pages with Playwright's Chromium.
//
//   cd web && node scripts/brand-images.mjs
//
// Needs Playwright with Chromium installed (`npx playwright install chromium`).
// Writes public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png
// and public/og.png. The text uses Inter, the design's web fallback font.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const mark = await readFile(`${publicDir}favicon.svg`, 'utf-8')
const markUrl = `data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}`

// Design tokens (docs/design/README.md §3).
const HIGHLIGHT = '#FFF6E0'
const INK = '#1F2328'
const MUTED = '#6B7280'

/** The map badge's beer mug (src/map/pins.ts). */
const BEER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h10v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 11h1.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H16"/><path d="M6 8c0-2 1.5-3 3-2.5C9.7 4 12 3.7 13 5c1.5-.7 3 .4 3 3"/><path d="M9.5 12v6M12.5 12v6"/></svg>'

/** The four sun states, as the map badges draw them (src/index.css). */
const STATES = [
  { from: '#FFC53D', to: '#F59E0B', icon: '#FFFFFF', scale: 1 },
  { from: '#FFF1B8', to: '#F7C948', icon: '#A16207', scale: 1 },
  { from: '#C6CBD3', to: '#8B919C', icon: '#FFFFFF', scale: 0.78 },
  { from: '#DCC8B4', to: '#A88D73', icon: '#FFFFFF', scale: 0.78 },
]

const page = (size, body, css = '') => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${size[0]}px; height: ${size[1]}px; overflow: hidden; }
  body { font-family: Inter, system-ui, sans-serif; }
  ${css}
</style></head><body>${body}</body></html>`

/** The mark centred on a square, at `fill` of its width. */
const icon = (size, fill, background) =>
  page(
    [size, size],
    `<img src="${markUrl}" alt="">`,
    `body { display: grid; place-items: center; background: ${background}; }
     img { width: ${size * fill}px; height: ${size * fill}px; }`,
  )

const og = page(
  [1200, 630],
  `<main>
    <img class="mark" src="${markUrl}" alt="">
    <div>
      <h1>Sol y Cerveza</h1>
      <p>Terrazas de Badajoz al sol</p>
    </div>
  </main>
  <ul>${STATES.map(
    (
      s,
    ) => `<li style="--from:${s.from};--to:${s.to};--icon:${s.icon};--scale:${s.scale}">
      <span class="badge">${BEER}</span></li>`,
  ).join('')}</ul>`,
  `body { position: relative; background: ${HIGHLIGHT}; color: ${INK}; }
   main { position: absolute; left: 96px; top: 0; bottom: 96px; display: flex; align-items: center; gap: 40px; }
   .mark { width: 160px; height: 160px; }
   h1 { margin: 0; font-size: 92px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
   p { margin: 14px 0 0; font-size: 44px; font-weight: 400; color: ${MUTED}; }
   ul { position: absolute; right: 96px; bottom: 84px; display: flex; align-items: flex-end; gap: 32px;
     margin: 0; padding: 0; list-style: none; }
   li { position: relative; width: calc(84px * var(--scale)); height: calc(84px * var(--scale));
     margin-bottom: calc(14px * var(--scale)); }
   /* The white teardrop of a map pin, its point down. */
   li::before { position: absolute; inset: 0; border-radius: 50% 50% 10% 50%; background: #fff; rotate: 45deg;
     box-shadow: 0 6px 18px rgba(31, 35, 40, 0.2); content: ''; }
   .badge { position: absolute; inset: 10%; display: grid; place-items: center; border: 4px solid #fff; border-radius: 50%;
     background: linear-gradient(160deg, var(--from), var(--to)); color: var(--icon);
     box-shadow: 0 2px 6px rgba(31, 35, 40, 0.25); }
   .badge svg { width: 55%; height: 55%; }`,
)

const outputs = [
  ['icon-192.png', [192, 192], icon(192, 0.9, 'transparent')],
  ['icon-512.png', [512, 512], icon(512, 0.9, 'transparent')],
  // Maskable: full-bleed background, the mark inside the 80 % safe circle.
  ['icon-maskable-512.png', [512, 512], icon(512, 0.6, HIGHLIGHT)],
  ['og.png', [1200, 630], og],
]

const browser = await chromium.launch()
try {
  for (const [name, [width, height], html] of outputs) {
    const tab = await browser.newPage({ viewport: { width, height } })
    await tab.setContent(html)
    await tab.evaluate(() => document.fonts.ready)
    await tab.screenshot({
      path: `${publicDir}${name}`,
      omitBackground: true,
    })
    await tab.close()
    process.stdout.write(`wrote public/${name}\n`)
  }
} finally {
  await browser.close()
}
