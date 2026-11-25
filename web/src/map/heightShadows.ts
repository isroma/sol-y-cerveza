import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from 'maplibre-gl'
import type { SunPosition } from '../sun/sunState.ts'
import { RELIEF_ZOOM, TILTED_ZOOM } from './camera.ts'

/**
 * Sun shadows drawn on the GPU from the LiDAR height model (prototype).
 *
 * Each ground pixel marches towards the sun through the height tiles that
 * `pipeline/src/solycerveza/heightmap.py` writes (the same surface model the
 * terrace horizons come from), so trees and terrain cast shadows too and the
 * map agrees with the list. The sun is only a uniform: moving it redraws, it
 * never recasts anything.
 *
 * For phones the march runs offscreen at about half the CSS resolution and
 * is upsampled with linear filtering; heights are sampled bilinearly and the
 * edge fades over the sun's penumbra, so edges are soft rather than 2 m
 * blocks. The tiles sit in one texture that is allocated once, each in a
 * fixed slot (tile x, y modulo the mosaic size), so panning uploads only the
 * tiles that come into view.
 */

const TILE_ZOOM = 15
const TILE_PX = 512
/** Tiles per side of the texture around the view (5 × 512 px ≈ 4.8 km). */
const MOSAIC_TILES = 5
const MOSAIC_PX = MOSAIC_TILES * TILE_PX
const WORLD_PX = 2 ** TILE_ZOOM * TILE_PX
const EARTH_CIRCUMFERENCE_M = 40075016.686
/** The terrace horizons' observer height (pipeline horizon.py). */
const EYE_HEIGHT_M = 1.2
const SHADOW_RGB = [0x6b / 255, 0x58 / 255, 0x48 / 255]
const MAX_OPACITY = 0.6
/** CSS pixels per pixel of the offscreen shade buffer. */
const SHADE_CSS_PX = 2
/** Tiles uploaded per frame at most, so a recentre never stalls one frame. */
const UPLOADS_PER_FRAME = 3

/** Deployed from the height-tiles branch; in dev, written by the pipeline (heightmap.py). */
export const HEIGHTS_URL = './data/heights'

const MARCH_VERTEX = `#version 300 es
uniform mat4 u_matrix;
in vec2 a_px;
out vec2 v_px;
void main() {
  v_px = a_px;
  gl_Position = u_matrix * vec4(a_px, 0.0, 1.0);
}`

const MARCH_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_heights;
uniform vec2 u_offset;
uniform vec2 u_dir;
uniform float u_tan_alt;
uniform float u_px_per_m;
uniform float u_max;
in vec2 v_px;
out vec4 fragColor;

const float SIZE = ${MOSAIC_PX}.0;

// Bilinear: R * 256 + G is linear in R and G, so the filtered channels
// decode to the filtered height.
float surface(vec2 px) {
  vec2 c = texture(u_heights, (px + u_offset) / SIZE).rg * 255.0;
  return (c.r * 256.0 + c.g) / 10.0;
}

void main() {
  ivec2 cell = (ivec2(v_px) + ivec2(u_offset)) % ${MOSAIC_PX};
  vec4 c = texelFetch(u_heights, cell, 0) * 255.0;
  float dsm = (c.r * 256.0 + c.g) / 10.0;
  if (dsm == 0.0) discard;
  float observer = dsm - c.b / 4.0 + ${EYE_HEIGHT_M};
  // The largest margin of the surface over the sun line, in units of the
  // edge's softness: 0.3 m for the 2 m cells plus the sun's penumbra
  // (0.27°, about 4.7 mm per metre of distance). Shade where it is > 0.
  float best = -2.0;
  // 2 m steps for the first 100 m, then 4 m out to 300 m, as far as the
  // terrace horizons look.
  for (int i = 0; i < 100; i++) {
    float d = i < 50 ? float(i + 1) * 2.0 : 100.0 + float(i - 49) * 4.0;
    vec2 q = v_px + u_dir * d * u_px_per_m;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= SIZE || q.y >= SIZE) break;
    float ray = observer + d * u_tan_alt;
    float soft = 0.3 + d * 0.0047;
    // Nothing in the mosaic reaches the sun line from here on.
    if (ray - u_max > soft) break;
    best = max(best, (surface(q) - ray) / soft);
    if (best >= 1.0) break;
  }
  if (best <= -1.0) discard;
  fragColor = vec4(smoothstep(-1.0, 1.0, best));
}`

const COMPOSITE_VERTEX = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const COMPOSITE_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D u_shade;
uniform vec2 u_screen;
uniform vec3 u_color;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  float a = texture(u_shade, gl_FragCoord.xy / u_screen).r * u_opacity;
  if (a < 0.004) discard;
  fragColor = vec4(u_color * a, a);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('heightShadows: no shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(`heightShadows: ${gl.getShaderInfoLog(shader) ?? ''}`)
  return shader
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(`heightShadows: ${gl.getProgramInfoLog(program) ?? ''}`)
  return program
}

/** The shadows' opacity at `zoom`, as SHADOW_OPACITY in camera.ts. */
export function shadowOpacity(zoom: number): number {
  const t = (zoom - RELIEF_ZOOM) / (TILTED_ZOOM - RELIEF_ZOOM)
  return Math.max(0, Math.min(1, t)) * MAX_OPACITY
}

/** The tile at the map's centre, at TILE_ZOOM. */
export function centreTile(lng: number, lat: number): [number, number] {
  const n = 2 ** TILE_ZOOM
  const r = (lat * Math.PI) / 180
  return [
    Math.floor(((lng + 180) / 360) * n),
    Math.floor(
      ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
    ),
  ]
}

/** The texture slot of a tile: its x and y modulo the mosaic size. */
export function tileSlot(x: number, y: number): number {
  const m = (v: number) => ((v % MOSAIC_TILES) + MOSAIC_TILES) % MOSAIC_TILES
  return m(x) + MOSAIC_TILES * m(y)
}

/** The offscreen shade buffer's size for a drawing buffer of `width` × `height`. */
export function shadeSize(
  width: number,
  height: number,
  pixelRatio: number,
): [number, number] {
  const scale = Math.min(1, 1 / (pixelRatio * SHADE_CSS_PX))
  return [
    Math.max(1, Math.ceil(width * scale)),
    Math.max(1, Math.ceil(height * scale)),
  ]
}

/** The highest surface in a decoded tile, in metres (Infinity without a 2D canvas). */
function tileMax(bitmap: ImageBitmap): number {
  if (typeof OffscreenCanvas === 'undefined') return Infinity
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return Infinity
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  let max = 0
  for (let i = 0; i < data.length; i += 4) {
    const h = (data[i] ?? 0) * 256 + (data[i + 1] ?? 0)
    if (h > max) max = h
  }
  // A metre of slack for any rounding in the 2D canvas.
  return max / 10 + 1
}

type Upload = { slot: number; key: string; bitmap: ImageBitmap | null }

type GlState = {
  march: WebGLProgram
  composite: WebGLProgram
  quad: WebGLBuffer
  screen: WebGLBuffer
  heights: WebGLTexture
  shade: WebGLTexture
  framebuffer: WebGLFramebuffer
  shadeSize: [number, number]
  uniforms: Record<string, WebGLUniformLocation | null>
}

export class HeightShadowLayer implements CustomLayerInterface {
  readonly id: string
  readonly type = 'custom'
  readonly renderingMode = '2d'
  private map: MapLibreMap | null = null
  private gl: WebGL2RenderingContext | null = null
  private state: GlState | null = null
  /** Top-left tile of the window the texture holds. */
  private origin: [number, number] | null = null
  /** The tile each texture slot holds or waits for. */
  private slots: (string | null)[] = []
  /** The highest surface in each slot, in metres. */
  private slotMax: number[] = []
  private uploads: Upload[] = []
  /** Bumped whenever the texture changes, so a cached march is redrawn. */
  private version = 0
  /** What the shade buffer holds now; redrawn only when this changes. */
  private drawn = ''
  /** The PNGs (small) and their highest surface; decoded only to upload. */
  private readonly blobs = new Map<string, Promise<Blob | null>>()
  private readonly maxima = new Map<string, number>()
  private sun: SunPosition = { altitude: -1, azimuth: 0 }
  /** The layer above this one, for re-adding it after a lost context. */
  private before: string | undefined
  private listening: MapLibreMap | null = null
  private restoring = false
  private zeros: Uint8Array | null = null

  constructor(id: string) {
    this.id = id
  }

  setSun(sun: SunPosition) {
    this.sun = sun
    this.map?.triggerRepaint()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl
    this.restoring = false
    if (this.listening !== map) {
      // MapLibre drops custom layers when the WebGL context is lost and
      // leaves re-adding them to the app (Map._contextLost).
      map.on('webglcontextlost', this.onContextLost)
      map.on('webglcontextrestored', this.onContextRestored)
      this.listening = map
    }
    this.state = this.createState(gl)
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    const state = this.state
    if (state && !gl.isContextLost()) {
      gl.deleteProgram(state.march)
      gl.deleteProgram(state.composite)
      gl.deleteBuffer(state.quad)
      gl.deleteBuffer(state.screen)
      gl.deleteTexture(state.heights)
      gl.deleteTexture(state.shade)
      gl.deleteFramebuffer(state.framebuffer)
    }
    for (const upload of this.uploads) upload.bitmap?.close()
    this.state = null
    this.uploads = []
    this.origin = null
    this.drawn = ''
    this.map = null
    this.gl = null
    if (!this.restoring && !gl.isContextLost() && this.listening) {
      this.listening.off('webglcontextlost', this.onContextLost)
      this.listening.off('webglcontextrestored', this.onContextRestored)
      this.listening = null
    }
  }

  private readonly onContextLost = () => {
    this.restoring = true
  }

  private readonly onContextRestored = () => {
    const map = this.listening
    if (!map || !this.restoring) return
    const add = () => {
      if (map.getLayer(this.id)) return
      const before =
        this.before && map.getLayer(this.before) ? this.before : undefined
      map.addLayer(this, before)
    }
    if (map.isStyleLoaded()) add()
    else map.once('style.load', add)
  }

  private createState(gl: WebGL2RenderingContext): GlState {
    const march = link(gl, MARCH_VERTEX, MARCH_FRAGMENT)
    const composite = link(gl, COMPOSITE_VERTEX, COMPOSITE_FRAGMENT)
    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        0,
        0,
        MOSAIC_PX,
        0,
        0,
        MOSAIC_PX,
        MOSAIC_PX,
        MOSAIC_PX,
      ]),
      gl.STATIC_DRAW,
    )
    const screen = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, screen)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    )
    // One texture for the whole mosaic, allocated once.
    const heights = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, heights)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, MOSAIC_PX, MOSAIC_PX)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // Slots wrap around, so neighbouring tiles are neighbours modulo the size.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    const shade = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    this.slots = Array.from({ length: MOSAIC_TILES ** 2 }, () => null)
    this.slotMax = this.slots.map(() => 0)
    const uniforms: Record<string, WebGLUniformLocation | null> = {}
    for (const name of [
      'u_matrix',
      'u_heights',
      'u_offset',
      'u_dir',
      'u_tan_alt',
      'u_px_per_m',
      'u_max',
    ])
      uniforms[name] = gl.getUniformLocation(march, name)
    for (const name of ['u_shade', 'u_screen', 'u_color', 'u_opacity'])
      uniforms[name] = gl.getUniformLocation(composite, name)
    return {
      march,
      composite,
      quad,
      screen,
      heights,
      shade,
      framebuffer,
      shadeSize: [0, 0],
      uniforms,
    }
  }

  private blob(key: string): Promise<Blob | null> {
    let blob = this.blobs.get(key)
    if (!blob) {
      blob = fetch(`${HEIGHTS_URL}/${key}.png`)
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => null)
      this.blobs.set(key, blob)
    }
    return blob
  }

  private async decode(key: string): Promise<ImageBitmap | null> {
    const blob = await this.blob(key)
    if (!blob) return null
    try {
      const bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })
      if (!this.maxima.has(key)) this.maxima.set(key, tileMax(bitmap))
      return bitmap
    } catch {
      return null
    }
  }

  /** Points the slots at the tiles around `centre`; new ones load in the background. */
  private recentre(centre: [number, number]) {
    const half = Math.floor(MOSAIC_TILES / 2)
    const origin: [number, number] = [centre[0] - half, centre[1] - half]
    this.origin = origin
    for (let i = 0; i < MOSAIC_TILES; i++) {
      for (let j = 0; j < MOSAIC_TILES; j++) {
        const x = origin[0] + i
        const y = origin[1] + j
        const key = `${x}/${y}`
        const slot = tileSlot(x, y)
        if (this.slots[slot] === key) continue
        this.slots[slot] = key
        this.slotMax[slot] = 0
        // Empty until the tile arrives: zero means no data, so no shadow.
        this.uploads.push({ slot, key, bitmap: null })
        const gl = this.gl
        void this.decode(key).then((bitmap) => {
          if (!bitmap) return
          if (this.gl !== gl || this.slots[slot] !== key) {
            bitmap.close()
            return
          }
          this.uploads.push({ slot, key, bitmap })
          this.map?.triggerRepaint()
        })
      }
    }
  }

  /** Writes queued tiles into their slots, a few per frame. */
  private upload(gl: WebGL2RenderingContext, state: GlState) {
    if (!this.uploads.length) return
    gl.bindTexture(gl.TEXTURE_2D, state.heights)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    let budget = UPLOADS_PER_FRAME
    while (this.uploads.length && budget > 0) {
      const upload = this.uploads.shift()
      if (!upload) break
      if (this.slots[upload.slot] !== upload.key) {
        upload.bitmap?.close()
        continue
      }
      const x = (upload.slot % MOSAIC_TILES) * TILE_PX
      const y = Math.floor(upload.slot / MOSAIC_TILES) * TILE_PX
      if (upload.bitmap) {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          x,
          y,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          upload.bitmap,
        )
        upload.bitmap.close()
        this.slotMax[upload.slot] = this.maxima.get(upload.key) ?? Infinity
        budget--
      } else {
        this.zeros ??= new Uint8Array(TILE_PX * TILE_PX * 4)
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          x,
          y,
          TILE_PX,
          TILE_PX,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.zeros,
        )
      }
      this.version++
    }
    if (this.uploads.length) this.map?.triggerRepaint()
  }

  private visible(map: MapLibreMap): boolean {
    return this.sun.altitude > 0 && shadowOpacity(map.getZoom()) > 0
  }

  /** Marches the shade into the offscreen buffer, when anything changed. */
  prerender(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map
    const state = this.state
    if (!map || !state || !this.visible(map)) return
    if (this.before === undefined) {
      const order = map.getLayersOrder()
      this.before = order[order.indexOf(this.id) + 1] ?? ''
    }
    const { lng, lat } = map.getCenter()
    const centre = centreTile(lng, lat)
    const half = Math.floor(MOSAIC_TILES / 2)
    if (
      !this.origin ||
      this.origin[0] + half !== centre[0] ||
      this.origin[1] + half !== centre[1]
    )
      this.recentre(centre)
    this.upload(gl, state)
    const origin = this.origin
    if (!origin) return

    const size = shadeSize(
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      window.devicePixelRatio || 1,
    )
    if (size[0] !== state.shadeSize[0] || size[1] !== state.shadeSize[1]) {
      gl.deleteTexture(state.shade)
      state.shade = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, state.shade)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, size[0], size[1])
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer)
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        state.shade,
        0,
      )
      state.shadeSize = size
      this.drawn = ''
    }

    // Mosaic pixels to mercator units, composed in doubles: mercator values
    // near Badajoz lose metres in float32 once multiplied by WORLD_PX.
    // mainMatrix takes mercator units (0..1).
    const m = options.defaultProjectionData.mainMatrix
    const s = 1 / WORLD_PX
    const ox = (origin[0] * TILE_PX) / WORLD_PX
    const oy = (origin[1] * TILE_PX) / WORLD_PX
    const matrix = new Float32Array(16)
    for (let row = 0; row < 4; row++) {
      const a = m[row] ?? 0
      const b = m[4 + row] ?? 0
      const c = m[8 + row] ?? 0
      const d = m[12 + row] ?? 0
      matrix[row] = a * s
      matrix[4 + row] = b * s
      matrix[8 + row] = c
      matrix[12 + row] = a * ox + b * oy + d
    }
    const key = `${matrix.join()}|${this.sun.altitude}|${this.sun.azimuth}|${this.version}|${size.join()}`
    if (key === this.drawn) return
    this.drawn = key

    const metresPerPx =
      (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / WORLD_PX
    const azimuth = (this.sun.azimuth * Math.PI) / 180
    const altitude = (this.sun.altitude * Math.PI) / 180
    const u = state.uniforms

    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer)
    gl.viewport(0, 0, size[0], size[1])
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.SCISSOR_TEST)
    gl.colorMask(true, true, true, true)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(state.march)
    gl.uniformMatrix4fv(u.u_matrix ?? null, false, matrix)
    gl.uniform2f(
      u.u_offset ?? null,
      (((origin[0] % MOSAIC_TILES) + MOSAIC_TILES) % MOSAIC_TILES) * TILE_PX,
      (((origin[1] % MOSAIC_TILES) + MOSAIC_TILES) % MOSAIC_TILES) * TILE_PX,
    )
    gl.uniform2f(u.u_dir ?? null, Math.sin(azimuth), -Math.cos(azimuth))
    gl.uniform1f(u.u_tan_alt ?? null, Math.tan(altitude))
    gl.uniform1f(u.u_px_per_m ?? null, 1 / metresPerPx)
    gl.uniform1f(u.u_max ?? null, Math.min(1e4, Math.max(...this.slotMax)))
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, state.heights)
    gl.uniform1i(u.u_heights ?? null, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, state.quad)
    const position = gl.getAttribLocation(state.march, 'a_px')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** Blends the upsampled shade over the map. */
  render(gl: WebGL2RenderingContext) {
    const map = this.map
    const state = this.state
    if (!map || !state || !this.drawn || !this.visible(map)) return
    const u = state.uniforms
    gl.useProgram(state.composite)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, state.shade)
    gl.uniform1i(u.u_shade ?? null, 0)
    gl.uniform2f(
      u.u_screen ?? null,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
    )
    gl.uniform3fv(u.u_color ?? null, SHADOW_RGB)
    gl.uniform1f(u.u_opacity ?? null, shadowOpacity(map.getZoom()))
    gl.bindBuffer(gl.ARRAY_BUFFER, state.screen)
    const position = gl.getAttribLocation(state.composite, 'a_pos')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
