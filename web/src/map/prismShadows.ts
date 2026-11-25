import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from 'maplibre-gl'
import type { SunPosition } from '../sun/sunState.ts'
import { RELIEF_ZOOM, TILTED_ZOOM } from './camera.ts'
import { BUILDINGS_URL } from './lidarBuildings.ts'
import {
  CAP_FLOATS,
  CELL_FLOATS,
  EDGE_FLOATS,
  mercatorX,
  mercatorY,
  prismFrame,
  type PrismArrays,
  type PrismFrame,
} from './prismGeometry.ts'
import type { PrismReply, PrismRequest } from './prismWorker.ts'
import { TREES_URL } from './treeCrowns.ts'

/**
 * Sun shadows as flat polygons, cast on the GPU from the prisms the map
 * draws: the LiDAR buildings and the tree crowns.
 *
 * Every outline edge and its heights are uploaded once. For each edge the
 * vertex shader draws a ground quad from the edge at its base height to the
 * edge at its top height, each pushed away from the sun by height ÷
 * tan(altitude); a floating prism (a crown) adds its outline pushed by its
 * base. Together they cover exactly the prism's shadow on flat ground. The
 * sun is two uniforms, so moving the time slider recasts nothing on the CPU.
 *
 * Overlapping quads would darken where they stack, so each pixel is shaded
 * once: the layer clears the depth buffer, then draws with the depth test
 * at its own depth and writes it, so a second quad over the same pixel fails
 * the test. (The depth buffer
 * rather than the stencil: MapLibre keeps its tile clipping masks in the
 * stencil and would not know to redraw them.)
 */

/** Shadows end here: past it the terraces' horizons don't look either (pipeline horizon.py). */
export const MAX_SHADOW_M = 300
const SHADOW_RGB = [0x6b / 255, 0x58 / 255, 0x48 / 255]
const MAX_OPACITY = 0.6
/** Badajoz: the frame the prisms are stored around. */
const ORIGIN: [number, number] = [-6.97, 38.88]

const EDGE_VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform vec2 u_dir;
uniform float u_cot;
in vec2 a_corner;
in vec4 a_edge;
in vec2 a_height;
void main() {
  vec2 p = mix(a_edge.xy, a_edge.zw, a_corner.x);
  float h = mix(a_height.x, a_height.y, a_corner.y);
  p += u_dir * min(h * u_cot, ${MAX_SHADOW_M}.0);
  gl_Position = u_matrix * vec4(p, 0.0, 1.0);
}`

const CAP_VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform vec2 u_dir;
uniform float u_cot;
in vec3 a_vertex;
void main() {
  vec2 p = a_vertex.xy + u_dir * min(a_vertex.z * u_cot, ${MAX_SHADOW_M}.0);
  gl_Position = u_matrix * vec4(p, 0.0, 1.0);
}`

const FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}`

/**
 * The shadows' opacity at `zoom`: they come in with the 3D buildings, once
 * the view tilts; in the flat and half-tilted views they only add grey noise.
 */
export function shadowOpacity(zoom: number): number {
  const t = (zoom - RELIEF_ZOOM) / (TILTED_ZOOM - RELIEF_ZOOM)
  return Math.max(0, Math.min(1, t)) * MAX_OPACITY
}

/**
 * Where a ground point's shadow offset points, per metre of height, in the
 * prisms' frame (x east, y south): away from the sun, 1 ÷ tan(altitude) long.
 */
export function shadowStep(sun: SunPosition): [number, number] {
  const azimuth = (sun.azimuth * Math.PI) / 180
  const cot = 1 / Math.tan((sun.altitude * Math.PI) / 180)
  return [-Math.sin(azimuth) * cot, Math.cos(azimuth) * cot]
}

/**
 * The map's matrix for points in the prisms' frame: mercator = origin +
 * point ÷ metresPerUnit, composed in doubles (float32 mercator values lose
 * metres).
 */
export function frameMatrix(
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
    matrix[8 + row] = main[8 + row] ?? 0
    matrix[12 + row] = a * ox + b * oy + (main[12 + row] ?? 0)
  }
  return matrix
}

/**
 * Runs of edges and cap indices of the cells that can shade the view
 * (`bounds` in the frame's metres, grown by the longest shadow), with
 * neighbouring cells merged into one run.
 */
export function visibleRuns(
  cells: Float32Array,
  bounds: [number, number, number, number],
): { edges: [number, number][]; caps: [number, number][] } {
  const edges: [number, number][] = []
  const caps: [number, number][] = []
  const push = (runs: [number, number][], start: number, count: number) => {
    if (!count) return
    const last = runs.at(-1)
    if (last && last[0] + last[1] === start) last[1] += count
    else runs.push([start, count])
  }
  for (let i = 0; i + CELL_FLOATS <= cells.length; i += CELL_FLOATS) {
    if (
      (cells[i] ?? 0) - MAX_SHADOW_M > bounds[2] ||
      (cells[i + 1] ?? 0) - MAX_SHADOW_M > bounds[3] ||
      (cells[i + 2] ?? 0) + MAX_SHADOW_M < bounds[0] ||
      (cells[i + 3] ?? 0) + MAX_SHADOW_M < bounds[1]
    )
      continue
    push(edges, cells[i + 4] ?? 0, cells[i + 5] ?? 0)
    push(caps, cells[i + 6] ?? 0, cells[i + 7] ?? 0)
  }
  return { edges, caps }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('prismShadows: no shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(`prismShadows: ${gl.getShaderInfoLog(shader) ?? ''}`)
  return shader
}

function link(gl: WebGL2RenderingContext, vertex: string) {
  const program = gl.createProgram()
  const shaders = [
    compile(gl, gl.VERTEX_SHADER, vertex),
    compile(gl, gl.FRAGMENT_SHADER, FRAGMENT),
  ]
  for (const shader of shaders) gl.attachShader(program, shader)
  gl.linkProgram(program)
  for (const shader of shaders) gl.deleteShader(shader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(`prismShadows: ${gl.getProgramInfoLog(program) ?? ''}`)
  return program
}

type Program = {
  program: WebGLProgram
  matrix: WebGLUniformLocation | null
  dir: WebGLUniformLocation | null
  cot: WebGLUniformLocation | null
  color: WebGLUniformLocation | null
}

function program(gl: WebGL2RenderingContext, vertex: string): Program {
  const p = link(gl, vertex)
  return {
    program: p,
    matrix: gl.getUniformLocation(p, 'u_matrix'),
    dir: gl.getUniformLocation(p, 'u_dir'),
    cot: gl.getUniformLocation(p, 'u_cot'),
    color: gl.getUniformLocation(p, 'u_color'),
  }
}

type GlState = {
  edgeProgram: Program
  capProgram: Program
  buffers: WebGLBuffer[]
  edgeVao: WebGLVertexArrayObject
  capVao: WebGLVertexArrayObject
  edgeAttribs: { edge: number; height: number }
  cells: Float32Array
  /** GPU bytes held, for checks. */
  bytes: number
}

/** Asks a one-off worker for the arrays (prismWorker.ts). */
function requestArrays(
  frame: PrismFrame,
  leafOff: boolean,
): Promise<PrismArrays> {
  const worker = new Worker(new URL('./prismWorker.ts', import.meta.url), {
    type: 'module',
  })
  const request: PrismRequest = {
    urls: [BUILDINGS_URL, TREES_URL].map(
      (url) => new URL(url, location.href).href,
    ),
    ...frame,
    leafOff,
  }
  return new Promise<PrismArrays>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<PrismReply>) => {
      worker.terminate()
      if ('error' in data) reject(new Error(data.error))
      else resolve(data.arrays)
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage(request)
  })
}

export class PrismShadowLayer implements CustomLayerInterface {
  readonly id: string
  readonly type = 'custom'
  readonly renderingMode = '2d'
  private readonly frame = prismFrame(...ORIGIN)
  private map: MapLibreMap | null = null
  private gl: WebGL2RenderingContext | null = null
  private state: GlState | null = null
  private sun: SunPosition = { altitude: -1, azimuth: 0 }
  /** From 1 Dec to 15 Mar deciduous crowns cast no shadow, as in the list (ADR-0007). */
  private leafOff = false
  /** Counts requests for the arrays, so a late answer to an older one is dropped. */
  private request = 0

  constructor(id: string) {
    this.id = id
  }

  /** Casts deciduous crowns' shadows (false) or not (true); rebuilds the arrays on a change. */
  setLeafOff(leafOff: boolean) {
    if (leafOff === this.leafOff) return
    this.leafOff = leafOff
    if (this.gl) this.load(this.gl)
  }

  setSun(sun: SunPosition) {
    if (sun.altitude === this.sun.altitude && sun.azimuth === this.sun.azimuth)
      return
    this.sun = sun
    this.map?.triggerRepaint()
  }

  /** GPU bytes the layer holds (0 until its data arrives). */
  get gpuBytes(): number {
    return this.state?.bytes ?? 0
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.gl = gl
    this.load(gl)
  }

  /**
   * Fetches and builds the arrays, then swaps them in. Also after a lost
   * context: the arrays aren't kept on the main thread once uploaded (about
   * 10 MB), and the files come from the HTTP cache by then.
   */
  private load(gl: WebGL2RenderingContext) {
    const request = ++this.request
    requestArrays(this.frame, this.leafOff).then(
      (arrays) => {
        if (request !== this.request || this.gl !== gl || gl.isContextLost())
          return
        this.release(gl)
        this.state = this.upload(gl, arrays)
        this.map?.triggerRepaint()
      },
      () => {
        // No shadows rather than a broken map.
      },
    )
  }

  private release(gl: WebGL2RenderingContext) {
    const state = this.state
    if (state && !gl.isContextLost()) {
      gl.deleteProgram(state.edgeProgram.program)
      gl.deleteProgram(state.capProgram.program)
      for (const buffer of state.buffers) gl.deleteBuffer(buffer)
      gl.deleteVertexArray(state.edgeVao)
      gl.deleteVertexArray(state.capVao)
    }
    this.state = null
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.release(gl)
    this.map = null
    this.gl = null
  }

  private upload(gl: WebGL2RenderingContext, arrays: PrismArrays): GlState {
    const edgeProgram = program(gl, EDGE_VERTEX)
    const capProgram = program(gl, CAP_VERTEX)
    const buffer = (target: number, data: BufferSource) => {
      const b = gl.createBuffer()
      gl.bindBuffer(target, b)
      gl.bufferData(target, data, gl.STATIC_DRAW)
      return b
    }

    const edgeVao = gl.createVertexArray()
    gl.bindVertexArray(edgeVao)
    const corners = buffer(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    )
    const corner = gl.getAttribLocation(edgeProgram.program, 'a_corner')
    gl.enableVertexAttribArray(corner)
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
    const edges = buffer(gl.ARRAY_BUFFER, arrays.edges)
    const edge = gl.getAttribLocation(edgeProgram.program, 'a_edge')
    const height = gl.getAttribLocation(edgeProgram.program, 'a_height')
    for (const location of [edge, height]) {
      gl.enableVertexAttribArray(location)
      gl.vertexAttribDivisor(location, 1)
    }

    const capVao = gl.createVertexArray()
    gl.bindVertexArray(capVao)
    const caps = buffer(gl.ARRAY_BUFFER, arrays.caps)
    const vertex = gl.getAttribLocation(capProgram.program, 'a_vertex')
    gl.enableVertexAttribArray(vertex)
    gl.vertexAttribPointer(vertex, 3, gl.FLOAT, false, CAP_FLOATS * 4, 0)
    const indices = buffer(gl.ELEMENT_ARRAY_BUFFER, arrays.capIndices)
    gl.bindVertexArray(null)

    return {
      edgeProgram,
      capProgram,
      buffers: [corners, edges, caps, indices],
      edgeVao,
      capVao,
      edgeAttribs: { edge, height },
      cells: arrays.cells,
      bytes:
        32 +
        arrays.edges.byteLength +
        arrays.caps.byteLength +
        arrays.capIndices.byteLength,
    }
  }

  /** The view's bounds in the prisms' frame. */
  private viewBounds(map: MapLibreMap): [number, number, number, number] {
    const bounds = map.getBounds()
    const { origin, metresPerUnit } = this.frame
    const x = (lon: number) => (mercatorX(lon) - origin[0]) * metresPerUnit
    const y = (lat: number) => (mercatorY(lat) - origin[1]) * metresPerUnit
    return [
      x(bounds.getWest()),
      y(bounds.getNorth()),
      x(bounds.getEast()),
      y(bounds.getSouth()),
    ]
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const map = this.map
    const state = this.state
    if (!map || !state || this.sun.altitude <= 0) return
    const opacity = shadowOpacity(map.getZoom())
    if (opacity <= 0) return
    const runs = visibleRuns(state.cells, this.viewBounds(map))
    const matrix = frameMatrix(
      options.defaultProjectionData.mainMatrix,
      this.frame,
    )
    const step = shadowStep(this.sun)
    const length = Math.hypot(step[0], step[1])
    const dir: [number, number] = [step[0] / length, step[1] / length]
    const color = SHADOW_RGB.map((c) => c * opacity)

    // Shade each pixel once: MapLibre has set this layer's depth range; the
    // first quad over a pixel writes it and any later one fails LESS. The
    // buffer is cleared first: in tests it already held this very depth
    // when the layer drew, which hid every shadow. Clearing loses nothing:
    // the only opaque 2D layer above this one is the flat building
    // footprints, under the 3D buildings.
    gl.depthMask(true)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    const begin = (p: Program) => {
      gl.useProgram(p.program)
      gl.uniformMatrix4fv(p.matrix, false, matrix)
      gl.uniform2f(p.dir, dir[0], dir[1])
      gl.uniform1f(p.cot, length)
      gl.uniform4f(
        p.color,
        color[0] ?? 0,
        color[1] ?? 0,
        color[2] ?? 0,
        opacity,
      )
    }

    begin(state.edgeProgram)
    gl.bindVertexArray(state.edgeVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers[1] ?? null)
    const stride = EDGE_FLOATS * 4
    for (const [start, count] of runs.edges) {
      const offset = start * stride
      gl.vertexAttribPointer(
        state.edgeAttribs.edge,
        4,
        gl.FLOAT,
        false,
        stride,
        offset,
      )
      gl.vertexAttribPointer(
        state.edgeAttribs.height,
        2,
        gl.FLOAT,
        false,
        stride,
        offset + 16,
      )
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    }

    if (runs.caps.length) {
      begin(state.capProgram)
      gl.bindVertexArray(state.capVao)
      for (const [start, count] of runs.caps)
        gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, start * 4)
    }
    gl.bindVertexArray(null)
  }
}
