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

export const HEIGHTS_URL = './data/heights'

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
in vec2 a_px;
out vec2 v_px;
void main() {
  v_px = a_px;
  gl_Position = u_matrix * vec4(a_px, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_heights;
uniform vec2 u_dir;
uniform float u_tan_alt;
uniform float u_px_per_m;
uniform float u_eye;
uniform vec3 u_color;
uniform float u_opacity;
in vec2 v_px;
out vec4 fragColor;

float surface(vec2 px) {
  vec4 c = texelFetch(u_heights, ivec2(px), 0) * 255.0;
  return (c.r * 256.0 + c.g) / 10.0;
}

void main() {
  vec4 c = texelFetch(u_heights, ivec2(v_px), 0) * 255.0;
  float dsm = (c.r * 256.0 + c.g) / 10.0;
  if (dsm == 0.0) discard;
  float observer = dsm - c.b / 4.0 + u_eye;
  float size = float(${MOSAIC_PX});
  // 2 m steps for the first 100 m, then 4 m out to 300 m, as far as the
  // terrace horizons look.
  for (int i = 0; i < 100; i++) {
    float d = i < 50 ? float(i + 1) * 2.0 : 100.0 + float(i - 49) * 4.0;
    vec2 q = v_px + u_dir * d * u_px_per_m;
    if (q.x < 0.0 || q.y < 0.0 || q.x >= size || q.y >= size) break;
    if (surface(q) > observer + d * u_tan_alt) {
      fragColor = vec4(u_color * u_opacity, u_opacity);
      return;
    }
  }
  discard;
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
    Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  ]
}

export class HeightShadowLayer implements CustomLayerInterface {
  readonly id: string
  readonly type = 'custom'
  readonly renderingMode = '2d'
  private map: MapLibreMap | null = null
  private gl: WebGL2RenderingContext | null = null
  private program: WebGLProgram | null = null
  private buffer: WebGLBuffer | null = null
  private texture: WebGLTexture | null = null
  /** Top-left tile of the texture. */
  private origin: [number, number] | null = null
  private readonly tiles = new Map<string, Promise<ImageBitmap | null>>()
  private sun: SunPosition = { altitude: -1, azimuth: 0 }

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
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`heightShadows: ${gl.getProgramInfoLog(program) ?? ''}`)
    this.program = program
    this.buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, MOSAIC_PX, 0, 0, MOSAIC_PX, MOSAIC_PX, MOSAIC_PX]),
      gl.STATIC_DRAW,
    )
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    gl.deleteProgram(this.program)
    gl.deleteBuffer(this.buffer)
    gl.deleteTexture(this.texture)
    this.map = null
    this.gl = null
  }

  private tile(x: number, y: number): Promise<ImageBitmap | null> {
    const key = `${x}/${y}`
    let tile = this.tiles.get(key)
    if (!tile) {
      tile = fetch(`${HEIGHTS_URL}/${key}.png`)
        .then(async (response) =>
          response.ok
            ? createImageBitmap(await response.blob(), {
                premultiplyAlpha: 'none',
                colorSpaceConversion: 'none',
              })
            : null,
        )
        .catch(() => null)
      this.tiles.set(key, tile)
    }
    return tile
  }

  /** Fills a fresh texture with the tiles around `centre`. */
  private recentre(gl: WebGL2RenderingContext, centre: [number, number]) {
    const half = Math.floor(MOSAIC_TILES / 2)
    const origin: [number, number] = [centre[0] - half, centre[1] - half]
    this.origin = origin
    gl.deleteTexture(this.texture)
    const texture = gl.createTexture()
    this.texture = texture
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, MOSAIC_PX, MOSAIC_PX)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    // An empty mosaic: zero means no data, so no shadow, until tiles arrive.
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      MOSAIC_PX,
      MOSAIC_PX,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(MOSAIC_PX * MOSAIC_PX * 4),
    )
    for (let i = 0; i < MOSAIC_TILES; i++) {
      for (let j = 0; j < MOSAIC_TILES; j++) {
        const x = origin[0] + i
        const y = origin[1] + j
        void this.tile(x, y).then((bitmap) => {
          if (!bitmap || this.texture !== texture || this.gl !== gl) return
          gl.bindTexture(gl.TEXTURE_2D, texture)
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            i * TILE_PX,
            j * TILE_PX,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            bitmap,
          )
          this.map?.triggerRepaint()
        })
      }
    }
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map
    if (!map || !this.program || this.sun.altitude <= 0) return
    const opacity = shadowOpacity(map.getZoom())
    if (opacity <= 0) return
    const { lng, lat } = map.getCenter()
    const centre = centreTile(lng, lat)
    const half = Math.floor(MOSAIC_TILES / 2)
    if (
      !this.origin ||
      this.origin[0] + half !== centre[0] ||
      this.origin[1] + half !== centre[1]
    )
      this.recentre(gl, centre)
    const origin = this.origin
    if (!origin) return

    // Mosaic pixels to mercator units, composed in doubles: mercator values
    // near Badajoz lose metres in float32 once multiplied by WORLD_PX.
    // mainMatrix takes mercator units (0..1); modelViewProjectionMatrix
    // takes world pixels at the current zoom.
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

    const metresPerPx =
      (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / WORLD_PX
    const azimuth = (this.sun.azimuth * Math.PI) / 180
    const altitude = (this.sun.altitude * Math.PI) / 180

    gl.useProgram(this.program)
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'u_matrix'), false, matrix)
    gl.uniform2f(
      gl.getUniformLocation(this.program, 'u_dir'),
      Math.sin(azimuth),
      -Math.cos(azimuth),
    )
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_tan_alt'), Math.tan(altitude))
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_px_per_m'), 1 / metresPerPx)
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_eye'), EYE_HEIGHT_M)
    gl.uniform3fv(gl.getUniformLocation(this.program, 'u_color'), SHADOW_RGB)
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_opacity'), opacity)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_heights'), 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const position = gl.getAttribLocation(this.program, 'a_px')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}
