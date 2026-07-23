"use client"

import { Billboard, Text, useTexture } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef, type RefObject } from "react"
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  MathUtils,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  type Group,
  type Mesh,
  type Texture,
} from "three"

import { EARTH_CLOUD_TEXTURE, EARTH_DAY_TEXTURE } from "./language-orbit-assets"
import {
  EARTH_ATMOSPHERE_RADIUS,
  EARTH_CLOUD_RADIUS,
  EARTH_RADIUS,
  buildLanguageOrbitLayout,
} from "./language-orbit-layout"
import type { LanguageOrbitPhase } from "./language-orbit-phase"
import {
  ORBIT_PERFORMANCE_SAMPLE_FRAMES,
  assessOrbitFramePerformance,
  type LanguageOrbitQualitySettings,
} from "./language-orbit-quality"
import type { LanguageGlobeEntry } from "./language-globe-model"

const DEFAULT_EARTH_ROTATION_SECONDS = 64
const DEFAULT_TEXT_ORBIT_SECONDS = 26
const MAX_FRAME_DELTA_SECONDS = 0.05

const CLOUD_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const CLOUD_FRAGMENT_SHADER = `
  uniform sampler2D dayMap;
  uniform sampler2D cloudMap;
  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 composite = texture2D(cloudMap, vUv).rgb;
    vec3 difference = max(composite - day, vec3(0.0));
    float cloudSignal = max(max(difference.r, difference.g), difference.b);
    float alpha = smoothstep(0.14, 0.34, cloudSignal) * 0.34;
    vec3 lightDirection = normalize(vec3(0.65, 0.3, 0.7));
    float light = 0.3 + max(dot(normalize(vWorldNormal), lightDirection), 0.0) * 0.75;
    vec3 cloudColor = mix(vec3(0.58, 0.72, 0.9), vec3(1.0), light);
    gl_FragColor = vec4(cloudColor * light, alpha);
  }
`

const ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const ATMOSPHERE_FRAGMENT_SHADER = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float facing = abs(dot(normalize(vWorldNormal), viewDirection));
    float rim = pow(1.0 - facing, 3.0);
    float alpha = smoothstep(0.08, 0.92, rim) * 0.72;
    vec3 atmosphere = mix(vec3(0.02, 0.22, 0.9), vec3(0.1, 0.78, 1.0), rim);
    gl_FragColor = vec4(atmosphere, alpha);
  }
`

const STAR_VERTEX_SHADER = `
  uniform float time;
  uniform float pixelRatio;
  uniform bool twinkle;
  attribute float aScale;
  attribute float aPhase;
  varying float vBrightness;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float pulse = twinkle ? 0.76 + 0.24 * sin(time * 1.35 + aPhase) : 0.9;
    vBrightness = pulse;
    gl_PointSize = (1.2 + aScale * 2.4) * pixelRatio * (18.0 / -viewPosition.z);
    gl_Position = projectionMatrix * viewPosition;
  }
`

const STAR_FRAGMENT_SHADER = `
  varying float vBrightness;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float distanceFromCenter = length(centered);
    float alpha = smoothstep(0.5, 0.04, distanceFromCenter) * vBrightness;
    vec3 color = mix(vec3(0.38, 0.65, 1.0), vec3(1.0, 0.93, 0.72), vBrightness);
    gl_FragColor = vec4(color, alpha);
  }
`

type EarthLanguageOrbitSceneProps = {
  languages: LanguageGlobeEntry[]
  animate: boolean
  quality: LanguageOrbitQualitySettings
  allowPerformanceDowngrade: boolean
  earthRotationSeconds?: number
  textOrbitSeconds?: number
  showClouds?: boolean
  showAtmosphere?: boolean
  showStars?: boolean
  phase: LanguageOrbitPhase
  onReady: () => void
  onPerformanceDowngrade: () => void
}

export function EarthLanguageOrbitScene({
  languages,
  animate,
  quality,
  allowPerformanceDowngrade,
  earthRotationSeconds = DEFAULT_EARTH_ROTATION_SECONDS,
  textOrbitSeconds = DEFAULT_TEXT_ORBIT_SECONDS,
  showClouds = true,
  showAtmosphere = true,
  showStars = true,
  phase,
  onReady,
  onPerformanceDowngrade,
}: EarthLanguageOrbitSceneProps) {
  const earthRef = useRef<Mesh>(null)
  const cloudsRef = useRef<Mesh>(null)
  const orbitRef = useRef<Group>(null)
  const starMaterialRef = useRef<ShaderMaterial>(null)
  const frameTimesRef = useRef(
    new Float32Array(ORBIT_PERFORMANCE_SAMPLE_FRAMES),
  )
  const frameCountRef = useRef(0)
  const slowWindowsRef = useRef(0)
  const downgradedRef = useRef(false)
  const layout = useMemo(() => buildLanguageOrbitLayout(languages), [languages])
  const syncedLabelsRef = useRef(new Set<string>())
  const readyNotifiedRef = useRef(false)
  const dayTexture = useOrbitTexture(EARTH_DAY_TEXTURE)

  useEffect(() => {
    syncedLabelsRef.current.clear()
    readyNotifiedRef.current = false
  }, [layout])

  useFrame((_, rawDelta) => {
    if (!animate) return

    const delta = Math.min(rawDelta, MAX_FRAME_DELTA_SECONDS)
    if (earthRef.current) {
      earthRef.current.rotation.y +=
        (delta * Math.PI * 2) / earthRotationSeconds
      phase.setEarthRotationY(earthRef.current.rotation.y)
    }
    if (cloudsRef.current) {
      cloudsRef.current.rotation.y +=
        (delta * Math.PI * 2) / (earthRotationSeconds * 0.9)
      phase.setCloudRotationY(cloudsRef.current.rotation.y)
    }
    if (orbitRef.current) {
      orbitRef.current.rotation.y -= (delta * Math.PI * 2) / textOrbitSeconds
      phase.setOrbitRotationY(orbitRef.current.rotation.y)
    }
    if (starMaterialRef.current) {
      starMaterialRef.current.uniforms.time.value += delta
      phase.setStarTime(starMaterialRef.current.uniforms.time.value)
    }

    if (
      allowPerformanceDowngrade &&
      quality.tier === "high" &&
      !downgradedRef.current
    ) {
      const sampleIndex =
        frameCountRef.current % ORBIT_PERFORMANCE_SAMPLE_FRAMES
      frameTimesRef.current[sampleIndex] = rawDelta * 1000
      frameCountRef.current += 1
      if (
        frameCountRef.current > 0 &&
        frameCountRef.current % ORBIT_PERFORMANCE_SAMPLE_FRAMES === 0
      ) {
        const decision = assessOrbitFramePerformance(
          Array.from(frameTimesRef.current),
        )
        slowWindowsRef.current =
          decision === "downgrade" ? slowWindowsRef.current + 1 : 0
        if (slowWindowsRef.current >= 2) {
          downgradedRef.current = true
          onPerformanceDowngrade()
        }
      }
    }
  })

  const markLabelReady = (id: string) => {
    syncedLabelsRef.current.add(id)
    if (
      !readyNotifiedRef.current &&
      syncedLabelsRef.current.size === layout.length
    ) {
      readyNotifiedRef.current = true
      onReady()
    }
  }

  return (
    <>
      <ambientLight intensity={0.16} color="#6688aa" />
      <hemisphereLight
        args={["#a8c7ff", "#02040c", 0.28]}
        position={[0, 3, 0]}
      />
      <directionalLight
        color="#fff0d4"
        intensity={4.4}
        position={[5.4, 2.8, 5.8]}
      />

      {showStars ? (
        <StarField
          count={quality.starCount}
          pixelRatio={quality.dpr}
          twinkle={quality.twinkle}
          initialTime={phase.getStarTime()}
          materialRef={starMaterialRef}
        />
      ) : null}

      <mesh ref={earthRef} rotation={[0, phase.getEarthRotationY(), 0]}>
        <sphereGeometry
          args={[
            EARTH_RADIUS,
            quality.sphereSegments,
            quality.sphereSegments / 2,
          ]}
        />
        <meshPhysicalMaterial
          map={dayTexture}
          roughness={0.72}
          metalness={0.04}
          clearcoat={0.08}
          clearcoatRoughness={0.34}
          depthTest
          depthWrite
        />
      </mesh>

      {showClouds ? (
        <EarthCloudLayer
          dayTexture={dayTexture}
          rotationY={phase.getCloudRotationY()}
          quality={quality}
          meshRef={cloudsRef}
        />
      ) : null}

      {showAtmosphere ? (
        <mesh>
          <sphereGeometry
            args={[
              EARTH_ATMOSPHERE_RADIUS,
              quality.sphereSegments,
              quality.sphereSegments / 2,
            ]}
          />
          <shaderMaterial
            vertexShader={ATMOSPHERE_VERTEX_SHADER}
            fragmentShader={ATMOSPHERE_FRAGMENT_SHADER}
            transparent
            depthTest
            depthWrite={false}
            side={BackSide}
            blending={AdditiveBlending}
          />
        </mesh>
      ) : null}

      <group
        ref={orbitRef}
        scale={quality.orbitScale}
        rotation={[
          MathUtils.degToRad(8),
          phase.getOrbitRotationY(),
          MathUtils.degToRad(-5),
        ]}
      >
        {layout.map((placement) => (
          <Billboard key={placement.id} position={placement.position} follow>
            <Text
              font={placement.font}
              fontSize={quality.textSize}
              color={placement.color}
              direction={placement.direction}
              anchorX="center"
              anchorY="middle"
              letterSpacing={0.015}
              outlineColor={placement.color}
              outlineWidth="1.5%"
              outlineBlur="10%"
              outlineOpacity={0.35}
              material-depthTest
              material-depthWrite={false}
              material-toneMapped={false}
              onSync={() => markLabelReady(placement.id)}
            >
              {`${placement.label}${placement.separator}`}
            </Text>
          </Billboard>
        ))}
      </group>
    </>
  )
}

function useOrbitTexture(path: string): Texture {
  const source = useTexture(path)
  const texture = useMemo(() => {
    const clone = source.clone()
    clone.colorSpace = SRGBColorSpace
    clone.wrapS = RepeatWrapping
    clone.needsUpdate = true
    return clone
  }, [source])

  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

function EarthCloudLayer({
  dayTexture,
  rotationY,
  quality,
  meshRef,
}: {
  dayTexture: Texture
  rotationY: number
  quality: LanguageOrbitQualitySettings
  meshRef: RefObject<Mesh | null>
}) {
  const cloudTexture = useOrbitTexture(EARTH_CLOUD_TEXTURE)
  const uniforms = useMemo(
    () => ({
      dayMap: { value: dayTexture },
      cloudMap: { value: cloudTexture },
    }),
    [cloudTexture, dayTexture],
  )

  return (
    <mesh ref={meshRef} rotation={[0, rotationY, 0]}>
      <sphereGeometry
        args={[
          EARTH_CLOUD_RADIUS,
          quality.sphereSegments,
          quality.sphereSegments / 2,
        ]}
      />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={CLOUD_VERTEX_SHADER}
        fragmentShader={CLOUD_FRAGMENT_SHADER}
        transparent
        depthTest
        depthWrite={false}
      />
    </mesh>
  )
}

function StarField({
  count,
  pixelRatio,
  twinkle,
  initialTime,
  materialRef,
}: {
  count: number
  pixelRatio: number
  twinkle: boolean
  initialTime: number
  materialRef: React.RefObject<ShaderMaterial | null>
}) {
  const geometry = useMemo(() => {
    const starGeometry = new BufferGeometry()
    const positions = new Float32Array(count * 3)
    const scales = new Float32Array(count)
    const phases = new Float32Array(count)
    let seed = 0x2f6e2b1
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0xffffffff
    }

    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (random() - 0.5) * 24
      positions[index * 3 + 1] = (random() - 0.5) * 15
      positions[index * 3 + 2] = -5 - random() * 16
      scales[index] = 0.25 + random() * 0.95
      phases[index] = random() * Math.PI * 2
    }
    starGeometry.setAttribute("position", new BufferAttribute(positions, 3))
    starGeometry.setAttribute("aScale", new BufferAttribute(scales, 1))
    starGeometry.setAttribute("aPhase", new BufferAttribute(phases, 1))
    return starGeometry
  }, [count])

  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo(
    () => ({
      time: { value: initialTime },
      pixelRatio: { value: pixelRatio },
      twinkle: { value: twinkle },
    }),
    [initialTime, pixelRatio, twinkle],
  )

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={STAR_VERTEX_SHADER}
        fragmentShader={STAR_FRAGMENT_SHADER}
        transparent
        depthTest
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  )
}
