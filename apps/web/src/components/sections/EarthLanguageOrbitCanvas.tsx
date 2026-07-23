"use client"

import { Canvas, useThree } from "@react-three/fiber"
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react"
import { ACESFilmicToneMapping, SRGBColorSpace } from "three"

import { EarthLanguageOrbitScene } from "./EarthLanguageOrbitScene"
import { createLanguageOrbitPhase } from "./language-orbit-phase"
import {
  resolveLanguageOrbitQuality,
  type LanguageOrbitQuality,
} from "./language-orbit-quality"
import type { LanguageGlobeEntry } from "./language-globe-model"

export type EarthLanguageOrbitCanvasProps = {
  className?: string
  languages: LanguageGlobeEntry[]
  width?: number
  active?: boolean
  reducedMotionOverride?: boolean
  paused?: boolean
  quality?: LanguageOrbitQuality
  autoRotate?: boolean
  earthRotationSeconds?: number
  textOrbitSeconds?: number
  initialLongitude?: number
  showClouds?: boolean
  showAtmosphere?: boolean
  showStars?: boolean
  onReady?: () => void
  onFailure?: (reason: "render-error" | "context-lost") => void
}

const DEFAULT_SCENE_WIDTH = 960
const NOOP = () => {}
const NOOP_FAILURE = (_reason: "render-error" | "context-lost") => {}

export function EarthLanguageOrbitCanvas({
  className,
  languages,
  width,
  active = true,
  reducedMotionOverride,
  paused = false,
  quality = "auto",
  autoRotate = true,
  earthRotationSeconds,
  textOrbitSeconds,
  initialLongitude,
  showClouds,
  showAtmosphere,
  showStars,
  onReady = NOOP,
  onFailure = NOOP_FAILURE,
}: EarthLanguageOrbitCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [observedWidth, setObservedWidth] = useState(
    width ?? DEFAULT_SCENE_WIDTH,
  )
  const [browserSignals, setBrowserSignals] = useState({
    coarsePointer: false,
    devicePixelRatio: 1,
  })
  const [forcedLowQuality, setForcedLowQuality] = useState(false)
  const reducedMotion = useReducedMotion(reducedMotionOverride)

  useEffect(() => {
    if (width != null) return
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setObservedWidth(entry.contentRect.width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [width])
  const sceneWidth = width ?? observedWidth

  useEffect(() => {
    const coarsePointer = window.matchMedia("(pointer: coarse)")
    const updateSignals = () => {
      setBrowserSignals({
        coarsePointer: coarsePointer.matches,
        devicePixelRatio: window.devicePixelRatio,
      })
    }
    updateSignals()
    coarsePointer.addEventListener("change", updateSignals)
    return () => coarsePointer.removeEventListener("change", updateSignals)
  }, [])

  const resolvedQuality = useMemo(
    () =>
      resolveLanguageOrbitQuality({
        quality: forcedLowQuality ? "low" : quality,
        width: sceneWidth,
        coarsePointer: browserSignals.coarsePointer,
        devicePixelRatio: browserSignals.devicePixelRatio,
        reducedMotion,
      }),
    [browserSignals, forcedLowQuality, quality, reducedMotion, sceneWidth],
  )
  const shouldAnimate = active && !paused && !reducedMotion && autoRotate
  const phase = useMemo(
    () => createLanguageOrbitPhase(initialLongitude),
    [initialLongitude],
  )
  const reportRenderFailure = useCallback(
    () => onFailure("render-error"),
    [onFailure],
  )

  return (
    <div ref={containerRef} className={className ?? "h-full w-full"}>
      <SceneErrorBoundary onFailure={reportRenderFailure}>
        <Canvas
          key={resolvedQuality.tier}
          aria-hidden="true"
          camera={{
            position: [0, 0.18, resolvedQuality.tier === "low" ? 10.6 : 7.8],
            fov: 42,
            near: 0.1,
            far: 40,
          }}
          dpr={resolvedQuality.dpr}
          frameloop={shouldAnimate ? resolvedQuality.frameloop : "demand"}
          gl={{
            alpha: true,
            antialias: resolvedQuality.tier === "high",
            powerPreference: "high-performance",
          }}
          fallback={<CanvasUnavailable onFailure={reportRenderFailure} />}
          onCreated={({ gl }) => {
            gl.outputColorSpace = SRGBColorSpace
            gl.toneMapping = ACESFilmicToneMapping
            gl.toneMappingExposure = 1.12
            gl.setClearColor(0x000000, 0)
          }}
        >
          <CanvasContextLifecycle
            onContextLost={() => onFailure("context-lost")}
          />
          <Suspense fallback={null}>
            <EarthLanguageOrbitScene
              languages={languages}
              animate={shouldAnimate}
              quality={resolvedQuality}
              allowPerformanceDowngrade={
                quality === "auto" && !forcedLowQuality
              }
              earthRotationSeconds={earthRotationSeconds}
              textOrbitSeconds={textOrbitSeconds}
              showClouds={showClouds}
              showAtmosphere={showAtmosphere}
              showStars={showStars}
              phase={phase}
              onReady={onReady}
              onPerformanceDowngrade={() => setForcedLowQuality(true)}
            />
          </Suspense>
        </Canvas>
      </SceneErrorBoundary>
    </div>
  )
}

function useReducedMotion(override: boolean | undefined) {
  const [preference, setPreference] = useState(override ?? false)

  useEffect(() => {
    if (override != null) return
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updatePreference = () => setPreference(motionQuery.matches)
    updatePreference()
    motionQuery.addEventListener("change", updatePreference)
    return () => motionQuery.removeEventListener("change", updatePreference)
  }, [override])

  return override ?? preference
}

function CanvasContextLifecycle({
  onContextLost,
}: {
  onContextLost: () => void
}) {
  const { gl } = useThree()

  useEffect(() => {
    const canvas = gl.domElement
    const handleContextLost = (event: Event) => {
      event.preventDefault()
      onContextLost()
    }
    canvas.addEventListener("webglcontextlost", handleContextLost, {
      once: true,
    })
    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost)
    }
  }, [gl, onContextLost])

  return null
}

function CanvasUnavailable({ onFailure }: { onFailure: () => void }) {
  useEffect(() => {
    onFailure()
  }, [onFailure])
  return null
}

class SceneErrorBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onFailure()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
