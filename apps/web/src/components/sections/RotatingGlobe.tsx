"use client"

import Image from "next/image"
import { useEffect, useRef } from "react"

const vertexShaderSource = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec2 aUv;

  uniform mat4 uProjection;
  uniform float uRotation;
  uniform float uTilt;

  varying vec3 vNormal;
  varying vec2 vUv;

  mat3 rotateX(float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return mat3(
      1.0, 0.0, 0.0,
      0.0, cosine, sine,
      0.0, -sine, cosine
    );
  }

  mat3 rotateY(float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return mat3(
      cosine, 0.0, -sine,
      0.0, 1.0, 0.0,
      sine, 0.0, cosine
    );
  }

  void main() {
    mat3 rotation = rotateX(uTilt) * rotateY(uRotation);
    vec3 worldPosition = rotation * aPosition;
    vNormal = normalize(rotation * aNormal);
    vUv = aUv;
    gl_Position = uProjection * vec4(worldPosition - vec3(0.0, 0.0, 3.0), 1.0);
  }
`

const fragmentShaderSource = `
  precision highp float;

  uniform sampler2D uTexture;

  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDirection = normalize(vec3(-0.7, 0.65, 1.0));
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float nightFill = smoothstep(-0.35, 0.45, dot(normal, lightDirection));
    float rim = pow(1.0 - max(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0), 3.2);

    vec3 textureColor = pow(texture2D(uTexture, vUv).rgb, vec3(2.2));
    vec3 litColor = textureColor * (0.09 + diffuse * 1.05) * (0.42 + nightFill * 0.58);
    litColor += vec3(0.08, 0.3, 0.72) * rim * 0.72;
    litColor = litColor / (vec3(1.0) + litColor);

    gl_FragColor = vec4(pow(litColor, vec3(1.0 / 2.2)), 1.0);
  }
`

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type)
  if (shader == null) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }

  return shader
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource,
  )

  if (vertexShader == null || fragmentShader == null) return null

  const program = gl.createProgram()
  if (program == null) return null

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }

  return program
}

function createSphere(segments = 72) {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let latitude = 0; latitude <= segments; latitude += 1) {
    const vertical = latitude / segments
    const phi = vertical * Math.PI
    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)

    for (let longitude = 0; longitude <= segments; longitude += 1) {
      const horizontal = longitude / segments
      const theta = (horizontal - 0.5) * Math.PI * 2
      const x = sinPhi * Math.sin(theta)
      const y = cosPhi
      const z = sinPhi * Math.cos(theta)

      positions.push(x, y, z)
      normals.push(x, y, z)
      uvs.push(horizontal, 1 - vertical)
    }
  }

  for (let latitude = 0; latitude < segments; latitude += 1) {
    for (let longitude = 0; longitude < segments; longitude += 1) {
      const row = segments + 1
      const upperLeft = latitude * row + longitude
      const lowerLeft = upperLeft + row

      indices.push(upperLeft, lowerLeft, upperLeft + 1)
      indices.push(lowerLeft, lowerLeft + 1, upperLeft + 1)
    }
  }

  return {
    indices: new Uint16Array(indices),
    normals: new Float32Array(normals),
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
  }
}

function perspective(aspect: number) {
  const fieldOfView = (38 * Math.PI) / 180
  const near = 0.1
  const far = 10
  const f = 1 / Math.tan(fieldOfView / 2)

  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ])
}

function bindAttribute(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string,
  values: Float32Array,
  size: number,
) {
  const location = gl.getAttribLocation(program, name)
  const buffer = gl.createBuffer()
  if (location < 0 || buffer == null) return null

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
  return buffer
}

export function RotatingGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fallbackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas == null) return

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      premultipliedAlpha: false,
    })
    if (gl == null) return

    const program = createProgram(gl)
    if (program == null) return

    const sphere = createSphere()
    const positionBuffer = bindAttribute(
      gl,
      program,
      "aPosition",
      sphere.positions,
      3,
    )
    const normalBuffer = bindAttribute(
      gl,
      program,
      "aNormal",
      sphere.normals,
      3,
    )
    const uvBuffer = bindAttribute(gl, program, "aUv", sphere.uvs, 2)
    const indexBuffer = gl.createBuffer()
    const texture = gl.createTexture()

    if (
      positionBuffer == null ||
      normalBuffer == null ||
      uvBuffer == null ||
      indexBuffer == null ||
      texture == null
    ) {
      return
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW)
    gl.useProgram(program)
    gl.enable(gl.DEPTH_TEST)
    gl.clearColor(0, 0, 0, 0)

    const projectionLocation = gl.getUniformLocation(program, "uProjection")
    const rotationLocation = gl.getUniformLocation(program, "uRotation")
    const tiltLocation = gl.getUniformLocation(program, "uTilt")
    const textureLocation = gl.getUniformLocation(program, "uTexture")
    gl.uniform1i(textureLocation, 0)
    gl.uniform1f(tiltLocation, -0.16)

    let animationFrame = 0
    let disposed = false
    let startTime = 0
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(bounds.width * pixelRatio))
      const height = Math.max(1, Math.round(bounds.height * pixelRatio))

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      gl.viewport(0, 0, width, height)
      gl.uniformMatrix4fv(
        projectionLocation,
        false,
        perspective(width / height),
      )
    }

    const draw = (time: number) => {
      if (disposed) return
      if (startTime === 0) startTime = time

      resize()
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.uniform1f(
        rotationLocation,
        reducedMotion ? -0.45 : -0.45 + ((time - startTime) / 1000) * 0.055,
      )
      gl.drawElements(gl.TRIANGLES, sphere.indices.length, gl.UNSIGNED_SHORT, 0)

      fallbackRef.current?.style.setProperty("opacity", "0")
      if (!reducedMotion) animationFrame = window.requestAnimationFrame(draw)
    }

    const image = new window.Image()
    image.decoding = "async"
    image.onload = () => {
      if (disposed) return
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)
      animationFrame = window.requestAnimationFrame(draw)
    }
    image.src = "/watch/images/languages/earth-blue-marble-2048.jpg"

    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      gl.deleteTexture(texture)
      gl.deleteBuffer(indexBuffer)
      gl.deleteBuffer(positionBuffer)
      gl.deleteBuffer(normalBuffer)
      gl.deleteBuffer(uvBuffer)
      gl.deleteProgram(program)
    }
  }, [])

  return (
    <div className="living-atlas-globe relative h-full w-full">
      <div
        ref={fallbackRef}
        className="absolute inset-0 transition-opacity duration-500"
      >
        <Image
          src="/watch/images/languages/living-atlas-globe-real.webp"
          alt=""
          fill
          loading="lazy"
          sizes="(max-width: 1023px) 92vw, 54vw"
          className="object-contain"
        />
      </div>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      />
    </div>
  )
}
