import { readFile } from 'node:fs/promises'
import type { Plugin } from 'vite'

/**
 * MapLibre's stylesheet styles every control it ships, but the app's map
 * (src/map/MapView.tsx) only uses the attribution control and markers. These
 * are the classes of the parts it doesn't use, by the MapLibre export or Map
 * option that would bring them back. A selector that names one of them (or a
 * class starting with one) is dropped. maplibreCss.test.ts fails when the app
 * starts using one of these, or when an upgrade renames the classes it keeps.
 */
export const UNUSED_CONTROLS: Readonly<Record<string, readonly string[]>> = {
  NavigationControl: [
    'maplibregl-ctrl-zoom-in',
    'maplibregl-ctrl-zoom-out',
    'maplibregl-ctrl-compass',
    'maplibregl-ctrl-group',
    'maplibregl-ctrl-icon',
  ],
  GeolocateControl: [
    'maplibregl-ctrl-geolocate',
    'maplibregl-user-location',
    'maplibregl-ctrl-group',
    'maplibregl-ctrl-icon',
  ],
  FullscreenControl: [
    'maplibregl-ctrl-fullscreen',
    'maplibregl-ctrl-shrink',
    'maplibregl-pseudo-fullscreen',
    'maplibregl-ctrl-group',
    'maplibregl-ctrl-icon',
  ],
  GlobeControl: [
    'maplibregl-ctrl-globe',
    'maplibregl-ctrl-group',
    'maplibregl-ctrl-icon',
  ],
  TerrainControl: [
    'maplibregl-ctrl-terrain',
    'maplibregl-ctrl-group',
    'maplibregl-ctrl-icon',
  ],
  ScaleControl: ['maplibregl-ctrl-scale'],
  // The logo: the LogoControl export or the Map's `maplibreLogo` option.
  LogoControl: ['maplibregl-ctrl-logo'],
  maplibreLogo: ['maplibregl-ctrl-logo'],
  Popup: ['maplibregl-popup'],
  // The Map option that shows "use two fingers to move the map".
  cooperativeGestures: [
    'maplibregl-cooperative-gesture',
    'maplibregl-desktop-message',
    'maplibregl-mobile-message',
  ],
}

const DROPPED = [...new Set(Object.values(UNUSED_CONTROLS).flat())]

function isDropped(selector: string): boolean {
  return [...selector.matchAll(/\.(maplibregl-[\w-]+)/g)].some(([, name]) =>
    DROPPED.some((prefix) => name?.startsWith(prefix)),
  )
}

type Item =
  | { kind: 'statement'; text: string }
  | { kind: 'block'; prelude: string; body: string }

/**
 * Splits CSS into its top-level statements and blocks. Enough for MapLibre's
 * minified stylesheet: it skips strings and comments, so a brace inside a
 * `url("data:…")` doesn't end a block.
 */
function parse(css: string): Item[] {
  const items: Item[] = []
  let start = 0
  let depth = 0
  let open = 0
  for (let i = 0; i < css.length; i++) {
    const char = css[i]
    if (char === '"' || char === "'") {
      const end = css.indexOf(char, i + 1)
      if (end === -1) throw new Error('maplibre css: unterminated string')
      i = end
    } else if (char === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end === -1) throw new Error('maplibre css: unterminated comment')
      if (depth === 0) {
        const before = css.slice(start, i).trim()
        if (before) throw new Error('maplibre css: comment inside a prelude')
        start = end + 2
      }
      i = end + 1
    } else if (char === '{') {
      if (depth === 0) open = i
      depth++
    } else if (char === '}') {
      depth--
      if (depth < 0) throw new Error('maplibre css: unbalanced braces')
      if (depth === 0) {
        items.push({
          kind: 'block',
          prelude: css.slice(start, open).trim(),
          body: css.slice(open + 1, i),
        })
        start = i + 1
      }
    } else if (char === ';' && depth === 0) {
      items.push({ kind: 'statement', text: css.slice(start, i + 1).trim() })
      start = i + 1
    }
  }
  if (depth !== 0 || css.slice(start).trim())
    throw new Error('maplibre css: unbalanced braces')
  return items
}

/** Splits a selector list at its top-level commas (not inside `:is(…)`). */
function selectors(prelude: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < prelude.length; i++) {
    const char = prelude[i]
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === ',' && depth === 0) {
      parts.push(prelude.slice(start, i))
      start = i + 1
    }
  }
  parts.push(prelude.slice(start))
  return parts.map((part) => part.trim())
}

function trimItems(css: string): { css: string; keyframes: Item[] } {
  let out = ''
  const keyframes: Item[] = []
  for (const item of parse(css)) {
    if (item.kind === 'statement') {
      out += item.text
    } else if (/^@(-webkit-)?keyframes\b/.test(item.prelude)) {
      keyframes.push(item)
    } else if (/^@(media|supports|layer|container)\b/.test(item.prelude)) {
      const inner = trimItems(item.body)
      keyframes.push(...inner.keyframes)
      if (inner.css) out += `${item.prelude}{${inner.css}}`
    } else if (item.prelude.startsWith('@')) {
      out += `${item.prelude}{${item.body}}`
    } else {
      const kept = selectors(item.prelude).filter((s) => !isDropped(s))
      if (kept.length > 0) out += `${kept.join(',')}{${item.body}}`
    }
  }
  return { css: out, keyframes }
}

/**
 * MapLibre's stylesheet without the rules of the controls the app doesn't
 * use (UNUSED_CONTROLS). Keyframes stay only while a kept rule names them.
 */
export function trimMaplibreCss(css: string): string {
  const { css: rules, keyframes } = trimItems(css)
  const used = keyframes.filter((item) => {
    if (item.kind !== 'block') return false
    const name = item.prelude.split(/\s+/)[1] ?? ''
    return new RegExp(`\\b${name}\\b`).test(rules)
  })
  return (
    rules +
    used
      .map((item) =>
        item.kind === 'block' ? `${item.prelude}{${item.body}}` : '',
      )
      .join('')
  )
}

const ENTRY = '/src/map/maplibre.css'
const UPSTREAM = 'maplibre-gl/dist/maplibre-gl.css'

/**
 * Serves src/map/maplibre.css as MapLibre's stylesheet, trimmed
 * (trimMaplibreCss), in the `maplibre` cascade layer. Dev and build alike,
 * so the e2e tests see what visitors get. The admin (dev only) imports the
 * full stylesheet itself.
 */
export function maplibreCss(): Plugin {
  return {
    name: 'maplibre-css',
    enforce: 'pre',
    async transform(_code, id) {
      if (!id.split('?')[0]?.endsWith(ENTRY)) return null
      const upstream = await this.resolve(UPSTREAM, id)
      if (!upstream) throw new Error(`maplibre-css: cannot resolve ${UPSTREAM}`)
      this.addWatchFile(upstream.id)
      const css = trimMaplibreCss(await readFile(upstream.id, 'utf8'))
      return { code: `@layer maplibre{${css}}`, map: null }
    },
  }
}
