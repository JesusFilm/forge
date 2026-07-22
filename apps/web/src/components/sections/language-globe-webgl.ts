import type { LanguageGlobeEntry } from "./language-globe-model"
import {
  projectGlobePoint,
  visibleProjectedLabelIndexes,
} from "./language-globe-projection"

const EARTH_TEXTURE_URL = "/watch/images/experiences/language-globe-earth.webp"

export type LanguageGlobeRuntime = {
  requestRender: () => void
  dispose: () => void
}

export function startLanguageGlobeRuntime({
  canvas,
  stage,
  root,
  getLanguages,
  getLabelElements,
  getPaused,
  getMobile,
  onReady,
}: {
  canvas: HTMLCanvasElement
  stage: HTMLDivElement
  root: HTMLElement
  getLanguages: () => LanguageGlobeEntry[]
  getLabelElements: () => Array<HTMLAnchorElement | null>
  getPaused: () => boolean
  getMobile: () => boolean
  onReady: (ready: boolean) => void
}): LanguageGlobeRuntime {
  const context = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  })
  if (!context) {
    onReady(false)
    return EMPTY_RUNTIME
  }
  const gl: WebGLRenderingContext = context

  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 aPosition;
      varying vec2 vPosition;
      void main() {
        vPosition = aPosition;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `,
  )
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying vec2 vPosition;
      uniform sampler2D uTexture;
      uniform float uRotation;
      const float PI = 3.141592653589793;
      void main() {
        vec2 point = vPosition;
        float radiusSquared = dot(point, point);
        if (radiusSquared > 1.0) discard;
        float z = sqrt(1.0 - radiusSquared);
        vec3 normal = normalize(vec3(point.x, point.y, z));
        float cosine = cos(uRotation);
        float sine = sin(uRotation);
        vec3 rotated = vec3(
          cosine * normal.x + sine * normal.z,
          normal.y,
          -sine * normal.x + cosine * normal.z
        );
        float longitude = atan(rotated.x, rotated.z) / (2.0 * PI) + 0.5;
        float latitude = asin(clamp(rotated.y, -1.0, 1.0)) / PI + 0.5;
        vec3 earth = texture2D(uTexture, vec2(fract(longitude), latitude)).rgb;
        float light = 0.52 + 0.48 * max(dot(normal, normalize(vec3(-0.35, 0.42, 0.82))), 0.0);
        float rim = pow(1.0 - z, 2.4);
        vec3 color = earth * light + vec3(0.08, 0.32, 0.62) * rim * 0.7;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  )
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const texture = gl.createTexture()
  const resources = { vertexShader, fragmentShader, program, buffer, texture }

  if (!vertexShader || !fragmentShader || !program || !buffer || !texture) {
    disposeWebGlResources(gl, resources)
    onReady(false)
    return EMPTY_RUNTIME
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    disposeWebGlResources(gl, resources)
    onReady(false)
    return EMPTY_RUNTIME
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  )
  gl.useProgram(program)
  const position = gl.getAttribLocation(program, "aPosition")
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const rotationUniform = gl.getUniformLocation(program, "uRotation")

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  let disposed = false
  let contextLost = false
  let textureReady = false
  let animationFrame = 0
  let framePending = false
  let intersectionVisible = true
  let documentVisible = document.visibilityState === "visible"
  let lastTime = performance.now()
  let rotation = 0
  let stageSize = 1
  let globeRadius = 1

  const requestRender = () => {
    if (disposed || contextLost || !textureReady || framePending) return
    framePending = true
    animationFrame = window.requestAnimationFrame(draw)
  }
  function draw(now: number) {
    framePending = false
    if (disposed || contextLost) return
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const pixels = Math.round(stageSize * dpr)
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels
      canvas.height = pixels
      gl.viewport(0, 0, pixels, pixels)
    }
    if (!getPaused() && intersectionVisible && documentVisible) {
      rotation += Math.min(now - lastTime, 40) * 0.000055
    }
    lastTime = now
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform1f(rotationUniform, rotation)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    positionLabels({
      radius: globeRadius,
      labels: getLanguages(),
      labelElements: getLabelElements(),
      rotation,
      mobile: getMobile(),
    })
    if (!getPaused() && intersectionVisible && documentVisible) requestRender()
  }

  const updateDimensions = () => {
    stageSize = Math.max(1, Math.min(stage.clientWidth, stage.clientHeight))
    globeRadius = stageSize * 0.53
    requestRender()
  }
  updateDimensions()

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(updateDimensions)
      : null
  if (resizeObserver) resizeObserver.observe(stage)
  else window.addEventListener("resize", updateDimensions)

  const intersectionObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          ([entry]) => {
            intersectionVisible = entry?.isIntersecting ?? true
            if (intersectionVisible) requestRender()
          },
          { rootMargin: "120px" },
        )
      : null
  intersectionObserver?.observe(root)

  const handleVisibility = () => {
    documentVisible = document.visibilityState === "visible"
    lastTime = performance.now()
    if (documentVisible) requestRender()
  }
  const handleContextLost = (event: Event) => {
    event.preventDefault()
    contextLost = true
    textureReady = false
    framePending = false
    window.cancelAnimationFrame(animationFrame)
    onReady(false)
  }
  const handleContextRestored = () => {
    // WebGL resources are invalid after restoration. Keep the CSS fallback
    // authoritative; a future remount will initialize a fresh context.
    contextLost = true
    onReady(false)
  }
  document.addEventListener("visibilitychange", handleVisibility)
  canvas.addEventListener("webglcontextlost", handleContextLost)
  canvas.addEventListener("webglcontextrestored", handleContextRestored)

  const image = new Image()
  image.decoding = "async"
  image.onload = () => {
    if (disposed || contextLost) return
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)
    textureReady = true
    onReady(true)
    requestRender()
  }
  image.onerror = () => {
    if (disposed) return
    onReady(false)
    dispose()
  }
  image.src = EARTH_TEXTURE_URL

  function dispose() {
    if (disposed) return
    disposed = true
    textureReady = false
    window.cancelAnimationFrame(animationFrame)
    image.onload = null
    image.onerror = null
    intersectionObserver?.disconnect()
    resizeObserver?.disconnect()
    if (!resizeObserver) window.removeEventListener("resize", updateDimensions)
    document.removeEventListener("visibilitychange", handleVisibility)
    canvas.removeEventListener("webglcontextlost", handleContextLost)
    canvas.removeEventListener("webglcontextrestored", handleContextRestored)
    disposeWebGlResources(gl, resources)
  }

  return { requestRender, dispose }
}

const EMPTY_RUNTIME: LanguageGlobeRuntime = {
  requestRender: () => {},
  dispose: () => {},
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function disposeWebGlResources(
  gl: WebGLRenderingContext,
  resources: {
    vertexShader: WebGLShader | null
    fragmentShader: WebGLShader | null
    program: WebGLProgram | null
    buffer: WebGLBuffer | null
    texture: WebGLTexture | null
  },
) {
  if (resources.texture) gl.deleteTexture(resources.texture)
  if (resources.buffer) gl.deleteBuffer(resources.buffer)
  if (resources.program) gl.deleteProgram(resources.program)
  if (resources.vertexShader) gl.deleteShader(resources.vertexShader)
  if (resources.fragmentShader) gl.deleteShader(resources.fragmentShader)
}

function positionLabels({
  radius,
  labels,
  labelElements,
  rotation,
  mobile,
}: {
  radius: number
  labels: LanguageGlobeEntry[]
  labelElements: Array<HTMLAnchorElement | null>
  rotation: number
  mobile: boolean
}) {
  const projected = labels.map((language) => {
    const point = projectGlobePoint({
      latitude: language.latitude ?? 0,
      longitude: language.longitude ?? 0,
      rotation,
      radius,
    })
    return {
      ...point,
      width: mobile ? 132 : 164,
      height: mobile ? 52 : 62,
    }
  })
  const visible = visibleProjectedLabelIndexes(projected)

  projected.forEach((point, index) => {
    const element = labelElements[index]
    if (!element) return
    const scale = 0.84 + Math.max(0, point.depth) * 0.16
    element.style.setProperty(
      "transform",
      `translate(-50%, -50%) translate(${point.x}px, ${point.y}px) scale(${scale})`,
    )
    element.style.setProperty("opacity", visible.has(index) ? "1" : "0")
    element.style.setProperty(
      "pointer-events",
      visible.has(index) ? "auto" : "none",
    )
    element.style.setProperty(
      "z-index",
      String(Math.round((point.depth + 1) * 100)),
    )
  })
}
