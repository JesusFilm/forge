"use client"

import type { Route } from "next"
import Link from "next/link"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react"

import type { EarthLanguageOrbitCanvasProps } from "./EarthLanguageOrbitCanvas"
import { EARTH_FALLBACK_IMAGE } from "./language-orbit-assets"
import type { LanguageGlobeEntry } from "./language-globe-model"
import { scheduleAfterPageLoadAndIdle } from "@/lib/deferred-browser-task"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"
const MAX_ORBIT_LANGUAGES = 12
const SCENE_READY_TIMEOUT_MS = 15_000

type OrbitCanvasComponent = ComponentType<EarthLanguageOrbitCanvasProps>

export function LanguageGlobeClient({
  sectionKey,
  heading,
  description,
  backgroundColor,
  languages,
  metadataUnavailable = false,
}: {
  sectionKey?: string | null
  heading: string
  description: string
  backgroundColor: string
  languages: LanguageGlobeEntry[]
  metadataUnavailable?: boolean
}) {
  const rootRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [OrbitCanvas, setOrbitCanvas] = useState<OrbitCanvasComponent | null>(
    null,
  )
  const [sceneWidth, setSceneWidth] = useState(960)
  const [canvasReady, setCanvasReady] = useState(false)
  const [runtimeFailed, setRuntimeFailed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [onscreen, setOnscreen] = useState(false)
  const [engineEligible, setEngineEligible] = useState(false)
  const [documentVisible, setDocumentVisible] = useState(true)
  const visualOrbitLanguages = useMemo(
    () => languages.slice(0, MAX_ORBIT_LANGUAGES),
    [languages],
  )
  const hasScene = visualOrbitLanguages.length > 0 && !metadataUnavailable

  useEffect(() => {
    const motionQuery = window.matchMedia(REDUCED_MOTION_QUERY)
    const updateMotion = () => setReducedMotion(motionQuery.matches)
    updateMotion()
    motionQuery.addEventListener("change", updateMotion)
    return () => motionQuery.removeEventListener("change", updateMotion)
  }, [])

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden)
    updateVisibility()
    document.addEventListener("visibilitychange", updateVisibility)
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (typeof IntersectionObserver === "undefined") {
      setOnscreen(true)
      setEngineEligible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const isIntersecting = entry?.isIntersecting ?? false
        setOnscreen(isIntersecting)
        if (isIntersecting) setEngineEligible(true)
      },
      { rootMargin: "120px 0px", threshold: 0.05 },
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setSceneWidth(entry.contentRect.width)
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [hasScene])

  useEffect(() => {
    if (!hasScene || !engineEligible || runtimeFailed) {
      setOrbitCanvas(null)
      setCanvasReady(false)
      return
    }

    let disposed = false
    const startImport = () => {
      void import("./EarthLanguageOrbitCanvas")
        .then(({ EarthLanguageOrbitCanvas }) => {
          if (!disposed) setOrbitCanvas(() => EarthLanguageOrbitCanvas)
        })
        .catch(() => {
          if (!disposed) setRuntimeFailed(true)
        })
    }
    const cancelImport = scheduleAfterPageLoadAndIdle(startImport, {
      idleTimeout: 1200,
      fallbackDelay: 0,
    })

    return () => {
      disposed = true
      cancelImport()
    }
  }, [engineEligible, hasScene, runtimeFailed])

  const handleReady = useCallback(() => {
    setCanvasReady(true)
  }, [])
  const handleFailure = useCallback(() => {
    setCanvasReady(false)
    setRuntimeFailed(true)
  }, [])
  useEffect(() => {
    if (!OrbitCanvas || canvasReady || runtimeFailed) return
    const timeout = globalThis.setTimeout(handleFailure, SCENE_READY_TIMEOUT_MS)
    return () => globalThis.clearTimeout(timeout)
  }, [OrbitCanvas, canvasReady, handleFailure, runtimeFailed])

  const sceneActive = onscreen && documentVisible
  const status = resolveOrbitStatus({
    metadataUnavailable,
    runtimeFailed,
    canvasReady,
  })

  return (
    <section
      ref={rootRef}
      className="relative isolate overflow-hidden px-4 py-14 text-white sm:px-8 sm:py-18 lg:py-20"
      style={{ backgroundColor }}
      data-language-globe
      data-globe-ready={canvasReady}
      data-globe-failed={runtimeFailed}
      data-section-key={sectionKey ?? undefined}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(16,80,190,0.2),transparent_37%),radial-gradient(circle_at_50%_100%,rgba(0,211,255,0.08),transparent_36%),linear-gradient(180deg,#01030a_0%,#020817_54%,#00030a_100%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-55 [background-image:radial-gradient(circle_at_12%_18%,rgba(255,255,255,.9)_0_1px,transparent_1.5px),radial-gradient(circle_at_82%_12%,rgba(101,171,255,.85)_0_1px,transparent_1.5px),radial-gradient(circle_at_32%_78%,rgba(255,232,180,.75)_0_1px,transparent_1.5px),radial-gradient(circle_at_68%_64%,rgba(255,255,255,.65)_0_1px,transparent_1.5px)] [background-size:173px_163px,211px_197px,257px_239px,293px_277px]"
        aria-hidden="true"
        data-orbit-star-backdrop
      />

      <div className="relative mx-auto max-w-[1240px]">
        <header className="relative z-20 mx-auto max-w-3xl text-center">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.34em] text-cyan-200/70 sm:text-xs">
            Languages of the world
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl">
            {heading}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
            {description}
          </p>
        </header>

        {hasScene ? (
          <div
            ref={stageRef}
            className="relative mx-auto -mt-4 h-[min(102vw,590px)] min-h-[370px] w-full max-w-[1180px] sm:-mt-2 sm:h-auto sm:aspect-[16/10]"
            data-language-orbit-stage
          >
            <div
              className={`absolute left-1/2 top-1/2 aspect-square w-[68%] max-w-[690px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300/25 bg-cover bg-center shadow-[0_0_22px_rgba(27,131,255,.92),0_0_88px_rgba(0,92,255,.45)] transition-opacity duration-500 sm:w-[58%] ${
                canvasReady ? "opacity-0" : "opacity-100"
              }`}
              style={{ backgroundImage: `url("${EARTH_FALLBACK_IMAGE}")` }}
              role="img"
              aria-label="Earth in space surrounded by language names"
              data-language-orbit-fallback
            >
              <div
                className="absolute inset-[-2%] rounded-full border border-cyan-300/25 shadow-[inset_0_0_24px_rgba(62,164,255,.35)]"
                aria-hidden="true"
              />
            </div>

            {OrbitCanvas && !runtimeFailed ? (
              <div
                className={`absolute inset-0 transition-opacity duration-500 ${
                  canvasReady ? "opacity-100" : "opacity-0"
                }`}
                data-language-orbit-canvas
              >
                <OrbitCanvas
                  languages={visualOrbitLanguages}
                  width={sceneWidth}
                  active={sceneActive}
                  reducedMotionOverride={reducedMotion}
                  paused={paused}
                  onReady={handleReady}
                  onFailure={handleFailure}
                />
              </div>
            ) : null}

            <p
              className={`absolute bottom-[13%] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap text-xs text-slate-300 transition-opacity sm:bottom-[8%] ${
                canvasReady ? "pointer-events-none opacity-0" : "opacity-90"
              }`}
              role="status"
              aria-live="polite"
            >
              {status}
            </p>

            {canvasReady ? (
              <button
                type="button"
                onClick={() => setPaused((value) => !value)}
                disabled={reducedMotion}
                className="absolute bottom-[5%] left-1/2 z-30 min-h-11 -translate-x-1/2 rounded-full border border-white/25 bg-slate-950/76 px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_40px_rgba(0,0,0,.4)] backdrop-blur-md transition hover:border-cyan-200/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100 disabled:cursor-default disabled:text-slate-300 sm:bottom-[2%]"
                aria-pressed={paused || reducedMotion}
              >
                {reducedMotion
                  ? "Reduced motion"
                  : paused
                    ? "Resume orbit"
                    : "Pause orbit"}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="relative mx-auto mt-10 max-w-2xl rounded-2xl border border-white/12 bg-slate-950/55 px-6 py-8 text-center shadow-xl backdrop-blur-sm">
            <div
              className="mx-auto h-28 w-28 rounded-full border border-sky-200/30 bg-cover bg-center shadow-[0_0_50px_rgba(47,139,255,0.28)]"
              style={{ backgroundImage: `url("${EARTH_FALLBACK_IMAGE}")` }}
              aria-hidden="true"
            />
            <p className="mt-5 text-sm leading-6 text-slate-200" role="status">
              {status}
            </p>
          </div>
        )}

        {languages.length > 0 ? (
          <nav
            aria-label="Browse videos by language"
            className="relative z-20 mx-auto mt-2 flex max-w-full snap-x flex-nowrap justify-start gap-x-2 overflow-x-auto pb-2 text-center text-sm [scrollbar-width:none] sm:mt-0 sm:max-w-5xl sm:flex-wrap sm:justify-center sm:overflow-visible sm:pb-0"
            data-language-orbit-links
          >
            {languages.map((language, index) => (
              <span
                key={language.id}
                className="inline-flex shrink-0 snap-start items-center gap-2"
              >
                {index > 0 ? (
                  <span className="text-cyan-300/35" aria-hidden="true">
                    •
                  </span>
                ) : null}
                <Link
                  href={language.href as Route}
                  className="min-h-11 content-center whitespace-nowrap rounded-md px-1.5 font-medium text-slate-300 underline-offset-4 transition hover:text-cyan-100 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-100"
                  data-globe-language-link
                >
                  <span>{language.nativeLabel}</span>
                  {language.nativeLabel !== language.englishLabel ? (
                    <span className="ml-1 text-slate-500">
                      ({language.englishLabel})
                    </span>
                  ) : null}
                </Link>
              </span>
            ))}
          </nav>
        ) : null}
      </div>
    </section>
  )
}

function resolveOrbitStatus({
  metadataUnavailable,
  runtimeFailed,
  canvasReady,
}: {
  metadataUnavailable: boolean
  runtimeFailed: boolean
  canvasReady: boolean
}) {
  if (metadataUnavailable) {
    return "Language destinations are temporarily unavailable. Please try again soon."
  }
  if (runtimeFailed) {
    return "The interactive Earth is unavailable. Language links remain available below."
  }
  return canvasReady
    ? "Interactive 3D Earth ready."
    : "Loading the interactive 3D Earth."
}
