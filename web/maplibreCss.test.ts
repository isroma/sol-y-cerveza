import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { trimMaplibreCss, UNUSED_CONTROLS } from './maplibreCss.ts'

const upstream = readFileSync(
  createRequire(import.meta.url).resolve('maplibre-gl/dist/maplibre-gl.css'),
  'utf8',
)
const trimmed = trimMaplibreCss(upstream)

const classes = (css: string) =>
  new Set([...css.matchAll(/\.(maplibregl-[\w-]+)/g)].map(([, name]) => name))

/**
 * What the app's map relies on: the map and its canvas, the gesture and box
 * zoom states, markers, the control corners and the compact attribution
 * control (src/map/MapView.tsx; index.css restyles the attribution).
 */
const KEPT = [
  'maplibregl-map',
  'maplibregl-canvas',
  'maplibregl-canvas-container',
  'maplibregl-interactive',
  'maplibregl-track-pointer',
  'maplibregl-touch-drag-pan',
  'maplibregl-touch-zoom-rotate',
  'maplibregl-boxzoom',
  'maplibregl-crosshair',
  'maplibregl-marker',
  'maplibregl-marker-draggable',
  'maplibregl-ctrl',
  'maplibregl-ctrl-top-left',
  'maplibregl-ctrl-top-right',
  'maplibregl-ctrl-bottom-left',
  'maplibregl-ctrl-bottom-right',
  'maplibregl-ctrl-attrib',
  'maplibregl-ctrl-attrib-button',
  'maplibregl-ctrl-attrib-inner',
  'maplibregl-compact',
  'maplibregl-compact-show',
  'maplibregl-attrib-empty',
]

const DROPPED = [...new Set(Object.values(UNUSED_CONTROLS).flat())]

/** The visitor app's sources: everything in src/ but the dev-only admin. */
function appSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      return entry.name === 'admin' ? [] : appSources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

describe('trimMaplibreCss', () => {
  it('keeps every class the app relies on', () => {
    const kept = classes(trimmed)
    expect(KEPT.filter((name) => !kept.has(name))).toEqual([])
  })

  it('drops every rule of the unused controls', () => {
    const left = [...classes(trimmed)].filter((name) =>
      DROPPED.some((prefix) => name?.startsWith(prefix)),
    )
    expect(left).toEqual([])
    expect(trimmed).not.toMatch(/@keyframes/)
  })

  it('names only classes MapLibre still has', () => {
    const all = [...classes(upstream)]
    const stale = DROPPED.filter(
      (prefix) => !all.some((name) => name?.startsWith(prefix)),
    )
    expect(stale).toEqual([])
  })

  it('keeps no class it does not know about', () => {
    // A class an upgrade adds shows up here: add it to KEPT or to UNUSED_CONTROLS.
    const unknown = [...classes(trimmed)].filter(
      (name) => name !== undefined && !KEPT.includes(name),
    )
    expect(unknown).toEqual([])
  })

  it('is much smaller than the full stylesheet', () => {
    expect(trimmed.length).toBeLessThan(upstream.length / 4)
  })

  it('splits selector lists and skips braces in strings', () => {
    const css =
      '.a,.maplibregl-popup,.b:is(.c,.d){x:url("data:image/svg+xml,%3Csvg{}")}' +
      '@media (hover:hover){.maplibregl-ctrl-logo{y:1}}' +
      '@media (hover:none){.maplibregl-ctrl-logo,.e{z:2}}' +
      '@keyframes maplibregl-spin{0%{a:b}}.f{animation:other 1s}'
    expect(trimMaplibreCss(css)).toBe(
      '.a,.b:is(.c,.d){x:url("data:image/svg+xml,%3Csvg{}")}' +
        '@media (hover:none){.e{z:2}}.f{animation:other 1s}',
    )
  })
})

describe('the app', () => {
  it('uses none of the controls whose CSS is dropped', () => {
    const uses = appSources(join(import.meta.dirname, 'src')).flatMap(
      (file) => {
        const source = readFileSync(file, 'utf8')
        return Object.keys(UNUSED_CONTROLS)
          .filter((name) => new RegExp(`\\b${name}\\b`).test(source))
          .map((name) => `${file}: ${name}`)
      },
    )
    expect(uses).toEqual([])
  })
})
