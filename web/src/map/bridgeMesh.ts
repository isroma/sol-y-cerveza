import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  ExpressionSpecification,
  FilterSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl'
import * as z from 'zod/mini'
import { RELIEF_ZOOM } from './camera.ts'
import { WALL_COLOR } from './mapStyle.ts'
import { nightBuildingColor } from './night.ts'
import { prismFrame, type PrismFrame } from './prismGeometry.ts'

/**
 * What the extrusions can't draw, since they only rise straight up: Puente
 * Real's slanted pylon and its cables, as triangles in metres from `origin`
 * (x east, y south, z up), and the outlines of the modelled bridge decks.
 * Written by the pipeline (bridges.py) and deployed from the height-tiles
 * branch, like buildings.json.
 */
export const BRIDGE_MESH_URL = './data/bridge-mesh.json'

const MeshFile = z.object({
  v: z.literal(1),
  origin: z.tuple([z.number(), z.number()]),
  triangles: z.array(z.number()),
  decks: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))),
})
export type BridgeMesh = z.infer<typeof MeshFile>

export function parseBridgeMesh(raw: unknown): BridgeMesh {
  return MeshFile.parse(raw)
}

/** The decks are drawn from here: halfway through the 3D buildings' fade-in. */
export const DECKS_ZOOM = RELIEF_ZOOM + 0.15

/** The mesh fades in with the 3D buildings (EXTRUSION_OPACITY). */
export function meshOpacity(zoom: number): number {
  return Math.min(1, Math.max(0, (zoom - RELIEF_ZOOM) / 0.3))
}

type Filter = FilterSpecification | null

/** An expression filter (not a legacy one): its operands are expressions or values. */
function isExpression(
  filter: FilterSpecification,
): filter is ExpressionSpecification {
  return Array.isArray(filter) && filter.length > 1 && Array.isArray(filter[1])
}

/**
 * The basemap filters that hand the modelled bridges' roads over to our
 * decks: the bridge road lines inside `decks` are skipped, and the hatched
 * bridge areas (OSM man_made=bridge) everywhere, since `within` takes no
 * polygons. Under a raised deck both showed. `original` is each layer's own
 * filter (a legacy one is left as it is); returns the filter to set for `hide`.
 */
export function bridgeRoadFilter(
  id: string,
  original: Filter,
  decks: BridgeMesh['decks'],
  hide: boolean,
): Filter {
  if (!hide) return original
  const skip: ExpressionSpecification =
    id === 'road_area_pattern'
      ? ['!=', ['get', 'class'], 'bridge']
      : ['!', ['within', { type: 'MultiPolygon', coordinates: decks }]]
  if (original === null || original === true) return skip
  return isExpression(original) ? ['all', original, skip] : original
}

/** The basemap layers bridgeRoadFilter changes. */
export function isBridgeRoadLayer(id: string, type: string): boolean {
  return (
    (type === 'line' && id.startsWith('bridge_')) || id === 'road_area_pattern'
  )
}

/**
 * Hands the bridge roads to the decks from DECKS_ZOOM, and back below it,
 * where no 3D is drawn. Returns a function that undoes it.
 */
function followZoom(map: MapLibreMap, decks: BridgeMesh['decks']) {
  const layers = map
    .getStyle()
    .layers.filter((layer) => isBridgeRoadLayer(layer.id, layer.type))
    .map((layer): [string, Filter] => [
      layer.id,
      map.getFilter(layer.id) ?? null,
    ])
  let hidden: boolean | null = null
  const update = () => {
    const hide = map.getZoom() >= DECKS_ZOOM
    if (hide === hidden) return
    hidden = hide
    for (const [id, original] of layers)
      map.setFilter(id, bridgeRoadFilter(id, original, decks, hide))
  }
  update()
  map.on('zoom', update)
  return () => {
    map.off('zoom', update)
    for (const [id, original] of layers)
      if (map.getLayer(id)) map.setFilter(id, original)
  }
}

/** The map's matrix for local metres from `frame`, heights in metres too. */
export function meshMatrix(
  main: ArrayLike<number>,
  frame: PrismFrame,
): Float32Array {
  const s = 1 / frame.metresPerUnit
  const [ox, oy] = frame.origin
  const matrix = new Float32Array(16)
  for (let row = 0; row < 4; row++) {
    const a = main[row] ?? 0
    const b = main[4 + row] ?? 0
    matrix[row] = a * s
    matrix[4 + row] = b * s
    matrix[8 + row] = (main[8 + row] ?? 0) * s
    matrix[12 + row] = a * ox + b * oy + (main[12 + row] ?? 0)
  }
  return matrix
}

export function hexColor(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Each triangle's vertices with its unit face normal: x, y, z, nx, ny, nz. */
export function withNormals(t: readonly number[]): Float32Array {
  const triangles = Math.floor(t.length / 9)
  const out = new Float32Array(triangles * 18)
  for (let i = 0; i < triangles * 9; i += 9) {
    const v = (k: number) => t[i + k] ?? 0
    const ux = v(3) - v(0), uy = v(4) - v(1), uz = v(5) - v(2) // prettier-ignore
    const wx = v(6) - v(0), wy = v(7) - v(1), wz = v(8) - v(2) // prettier-ignore
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]
    const length = Math.hypot(...n) || 1
    for (let k = 0; k < 3; k++) {
      const o = (i / 3 + k) * 6
      out.set([v(k * 3), v(k * 3 + 1), v(k * 3 + 2)], o)
      out.set(
        n.map((c) => c / length),
        o + 3,
      )
    }
  }
  return out
}

const VERTEX = `#version 300 es
in vec3 a_pos;
in vec3 a_normal;
uniform mat4 u_matrix;
uniform vec3 u_light;
out float v_shade;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  v_shade = 0.72 + 0.28 * abs(dot(a_normal, u_light));
}`

const FRAGMENT = `#version 300 es
precision mediump float;
in float v_shade;
uniform vec3 u_color;
uniform float u_opacity;
out vec4 color;
void main() {
  color = vec4(u_color * v_shade * u_opacity, u_opacity);
}`

type GlState = {
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  buffer: WebGLBuffer
  count: number
  matrix: WebGLUniformLocation | null
  light: WebGLUniformLocation | null
  tint: WebGLUniformLocation | null
  opacity: WebGLUniformLocation | null
}

function upload(gl: WebGL2RenderingContext, data: Float32Array): GlState {
  const program = gl.createProgram()
  const vao = gl.createVertexArray()
  const buffer = gl.createBuffer()
  const shaders: [number, string][] = [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ]
  for (const [type, source] of shaders) {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('bridge mesh: no shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
  }
  gl.linkProgram(program)
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
  const pos = gl.getAttribLocation(program, 'a_pos')
  const normal = gl.getAttribLocation(program, 'a_normal')
  gl.enableVertexAttribArray(pos)
  gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 24, 0)
  gl.enableVertexAttribArray(normal)
  gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12)
  gl.bindVertexArray(null)
  return {
    program,
    vao,
    buffer,
    count: data.length / 6,
    matrix: gl.getUniformLocation(program, 'u_matrix'),
    light: gl.getUniformLocation(program, 'u_light'),
    tint: gl.getUniformLocation(program, 'u_color'),
    opacity: gl.getUniformLocation(program, 'u_opacity'),
  }
}

/**
 * Draws the bridge mesh in the 3D buildings' colour (and the night's), and
 * hands the modelled bridges' roads to the decks. Without the file (offline,
 * a 404) it draws nothing and the basemap keeps its roads.
 */
export class BridgeMeshLayer implements CustomLayerInterface {
  readonly id: string
  readonly type = 'custom'
  readonly renderingMode = '3d'
  private map: MapLibreMap | null = null
  private frame: PrismFrame | null = null
  private color = hexColor(WALL_COLOR)
  private state: GlState | null = null
  private undoRoads: (() => void) | null = null

  constructor(id: string) {
    this.id = id
  }

  /** `depth` from nightDepth: null for day, 0–1 for dusk to deep night. */
  setNight(depth: number | null) {
    this.color = hexColor(
      depth === null ? WALL_COLOR : nightBuildingColor(depth),
    )
    this.map?.triggerRepaint()
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    void fetch(BRIDGE_MESH_URL)
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(`bridge mesh: HTTP ${response.status}`)),
      )
      .then((raw: unknown) => {
        const mesh = parseBridgeMesh(raw)
        if (this.map !== map || gl.isContextLost()) return
        this.frame = prismFrame(mesh.origin[0], mesh.origin[1])
        this.state = upload(gl, withNormals(mesh.triangles))
        this.undoRoads = followZoom(map, mesh.decks)
        map.triggerRepaint()
      })
      .catch(() => {
        // No mesh rather than a broken map; the basemap keeps its roads.
      })
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.undoRoads?.()
    this.undoRoads = null
    this.map = null
    if (!this.state) return
    gl.deleteBuffer(this.state.buffer)
    gl.deleteVertexArray(this.state.vao)
    gl.deleteProgram(this.state.program)
    this.state = null
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const { state, frame, map } = this
    if (!state || !frame || !map) return
    const opacity = meshOpacity(map.getZoom())
    if (opacity <= 0) return
    gl.useProgram(state.program)
    gl.uniformMatrix4fv(
      state.matrix,
      false,
      meshMatrix(options.defaultProjectionData.mainMatrix, frame),
    )
    gl.uniform3f(state.light, 0.35, -0.55, 0.76)
    gl.uniform3f(state.tint, ...this.color)
    gl.uniform1f(state.opacity, opacity)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(state.vao)
    gl.drawArrays(gl.TRIANGLES, 0, state.count)
    gl.bindVertexArray(null)
  }
}
