import type { Terrace, TerracesFile } from '../data/terraces.ts'

/** Builds a 360-bin horizon from `[firstBin, lastBin, value]` runs. */
export function horizonFromRuns(
  runs: readonly (readonly [number, number, number])[],
): number[] {
  const horizon = new Array<number>(360).fill(0)
  for (const [first, last, value] of runs) {
    for (let bin = first; bin <= last; bin++) horizon[bin] = value
  }
  return horizon
}

// Same positions and horizon shapes as the sample terraces in
// public/data/terraces.json, copied so tests survive the real data (#12).

/** Open square: 8.3° all around. */
export const plazaAlta = {
  id: 'sample:plaza-alta',
  name: 'Terraza de ejemplo · Plaza Alta',
  kind: 'restaurant',
  venue: { lat: 38.8826, lon: -6.9698 },
  terrace: { lat: 38.88256, lon: -6.96976 },
  sources: ['sample'],
  verified: null,
  horizon: horizonFromRuns([[0, 359, 83]]),
} satisfies Terrace

/** Narrow north–south street: open only along its axis. */
export const calleMenacho = {
  id: 'sample:calle-menacho',
  name: 'Terraza de ejemplo · Calle Menacho',
  kind: 'bar',
  venue: { lat: 38.8771, lon: -6.9705 },
  terrace: { lat: 38.87712, lon: -6.97047 },
  sources: ['sample'],
  verified: null,
  horizon: horizonFromRuns([
    [0, 19, 130],
    [20, 160, 665],
    [161, 199, 130],
    [200, 340, 665],
    [341, 359, 130],
  ]),
} satisfies Terrace

/** Under trees: 31° all around. */
export const paseoSanFrancisco = {
  id: 'sample:paseo-san-francisco',
  name: 'Terraza de ejemplo · Paseo de San Francisco',
  kind: 'cafe',
  venue: { lat: 38.877, lon: -6.9733 },
  terrace: { lat: 38.87698, lon: -6.97325 },
  sources: ['sample'],
  verified: null,
  horizon: horizonFromRuns([[0, 359, 310]]),
} satisfies Terrace

export const withoutHorizon = {
  id: 'sample:sin-horizonte',
  name: 'Terraza de ejemplo · Sin horizonte',
  kind: 'pub',
  venue: { lat: 38.8789, lon: -6.9707 },
  terrace: { lat: 38.87885, lon: -6.97065 },
  sources: ['sample'],
  verified: null,
  horizon: null,
} satisfies Terrace

export const sampleFile: TerracesFile = {
  version: 2,
  generated: '2026-11-22T00:00:00Z',
  sample: true,
  attribution: ['Datos de ejemplo: terrazas y horizontes ficticios'],
  terraces: [calleMenacho, paseoSanFrancisco, plazaAlta, withoutHorizon],
}
