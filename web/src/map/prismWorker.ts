/**
 * Builds the prism shadows' arrays (prismGeometry.ts) off the main thread:
 * fetches the extrusion files, decodes them with the shared codec and posts
 * the typed arrays back, transferred rather than copied.
 */
import { decodeExtrusions } from './extrusionCodec.ts'
import { prismArrays, type PrismArrays } from './prismGeometry.ts'

export type PrismRequest = {
  urls: string[]
  origin: [number, number]
  metresPerUnit: number
  /** Deciduous crowns cast nothing (ADR-0007). */
  leafOff: boolean
}

export type PrismReply = { arrays: PrismArrays } | { error: string }

async function load(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return decodeExtrusions(await response.json())
}

self.onmessage = async ({ data }: MessageEvent<PrismRequest>) => {
  // A missing file (say, trees in dev) casts nothing rather than failing all.
  const collections = (
    await Promise.all(data.urls.map((url) => load(url).catch(() => null)))
  ).filter((collection) => collection !== null)
  try {
    const arrays = prismArrays(collections, data, data.leafOff)
    const reply: PrismReply = { arrays }
    self.postMessage(reply, {
      transfer: [
        arrays.edges.buffer,
        arrays.caps.buffer,
        arrays.capIndices.buffer,
        arrays.cells.buffer,
      ],
    })
  } catch (error) {
    const reply: PrismReply = { error: String(error) }
    self.postMessage(reply)
  }
}
