"use client"

import Link from "next/link"
import type { Route } from "next"
import { useEffect, useMemo, useRef, useState } from "react"

import type { LanguageGlobeEntry } from "./language-globe-model"
import type { LanguageGlobeRuntime } from "./language-globe-webgl"

const MOBILE_MEDIA_QUERY = "(max-width: 640px)"

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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const pausedRef = useRef(false)
  const requestRenderRef = useRef<() => void>(() => {})
  const [paused, setPaused] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [canvasReady, setCanvasReady] = useState(false)
  const globeLanguages = useMemo(
    () =>
      languages
        .filter(
          (language) => language.latitude != null && language.longitude != null,
        )
        .slice(0, mobile ? 6 : 12),
    [languages, mobile],
  )
  const hasGlobe = globeLanguages.length > 0 && !metadataUnavailable
  const globeLanguagesRef = useRef(globeLanguages)
  const mobileRef = useRef(mobile)
  globeLanguagesRef.current = globeLanguages
  mobileRef.current = mobile

  useEffect(() => {
    pausedRef.current = paused
    requestRenderRef.current()
  }, [paused])

  useEffect(() => {
    requestRenderRef.current()
  }, [globeLanguages, mobile])

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_MEDIA_QUERY)
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updateMobile = () => setMobile(mobileQuery.matches)
    const updateMotion = () => {
      if (motionQuery.matches) setPaused(true)
    }
    updateMobile()
    updateMotion()
    mobileQuery.addEventListener("change", updateMobile)
    motionQuery.addEventListener("change", updateMotion)
    return () => {
      mobileQuery.removeEventListener("change", updateMobile)
      motionQuery.removeEventListener("change", updateMotion)
    }
  }, [])

  useEffect(() => {
    if (!hasGlobe) {
      setCanvasReady(false)
      return
    }
    const canvas = canvasRef.current
    const stage = stageRef.current
    const root = rootRef.current
    if (!canvas || !stage || !root) return

    let disposed = false
    let runtime: LanguageGlobeRuntime | null = null
    void import("./language-globe-webgl")
      .then(({ startLanguageGlobeRuntime }) => {
        if (disposed) return
        runtime = startLanguageGlobeRuntime({
          canvas,
          stage,
          root,
          getLanguages: () => globeLanguagesRef.current,
          getLabelElements: () => labelRefs.current,
          getPaused: () => pausedRef.current,
          getMobile: () => mobileRef.current,
          onReady: setCanvasReady,
        })
        requestRenderRef.current = runtime.requestRender
      })
      .catch(() => {
        if (!disposed) setCanvasReady(false)
      })

    return () => {
      disposed = true
      requestRenderRef.current = () => {}
      runtime?.dispose()
    }
  }, [hasGlobe])

  return (
    <section
      ref={rootRef}
      className="relative isolate overflow-hidden px-4 py-16 text-white sm:px-8 sm:py-20 lg:py-24"
      style={{ backgroundColor }}
      data-language-globe
      data-section-key={sectionKey ?? undefined}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(64,144,255,0.26),transparent_38%),linear-gradient(180deg,rgba(2,10,24,0.18),rgba(2,7,18,0.72))]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="mx-auto max-w-3xl rounded-2xl bg-slate-950/72 px-5 py-6 text-center shadow-2xl backdrop-blur-sm sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-200/80">
            Languages of the world
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            {heading}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
            {description}
          </p>
        </div>

        {hasGlobe ? (
          <div className="relative mx-auto mt-8 aspect-square w-full max-w-[760px] sm:mt-12">
            <div
              ref={stageRef}
              className="absolute inset-[10%] rounded-full shadow-[0_0_80px_rgba(47,139,255,0.3)] sm:inset-[12%]"
            >
              <div
                className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_34%_28%,rgba(255,255,255,0.18),transparent_24%),radial-gradient(circle_at_50%_50%,#153c70,#071629_70%)]"
                aria-hidden="true"
              />
              <canvas
                ref={canvasRef}
                className={`absolute inset-0 h-full w-full rounded-full transition-opacity duration-500 ${canvasReady ? "opacity-100" : "opacity-0"}`}
                aria-hidden="true"
              />
            </div>
            <div className="absolute inset-0" aria-hidden="true">
              {globeLanguages.map((language, index) => (
                <Link
                  key={`orbit-${language.id}`}
                  ref={(node) => {
                    labelRefs.current[index] = node
                  }}
                  href={language.href as Route}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-1/2 min-h-11 w-[132px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/24 bg-slate-950/86 px-3 py-2 text-center text-white opacity-0 shadow-xl backdrop-blur-md transition-[opacity,box-shadow] hover:border-sky-200/70 hover:shadow-sky-500/20 sm:w-[164px] sm:px-4 sm:py-3"
                >
                  <span className="block truncate text-sm font-semibold sm:text-base">
                    {language.nativeLabel}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-300 sm:text-xs">
                    {language.englishLabel}
                  </span>
                </Link>
              ))}
            </div>
            {canvasReady ? (
              <button
                type="button"
                onClick={() => setPaused((value) => !value)}
                className="absolute bottom-[4%] left-1/2 z-20 min-h-11 -translate-x-1/2 rounded-full border border-white/25 bg-slate-950/88 px-5 py-2 text-sm font-semibold text-white shadow-xl backdrop-blur-md transition hover:border-sky-200/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-[7%]"
                aria-pressed={paused}
              >
                {paused ? "Resume globe" : "Pause globe"}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-white/15 bg-slate-950/72 px-6 py-8 text-center shadow-xl backdrop-blur-sm">
            <div
              className="mx-auto h-28 w-28 rounded-full border border-sky-200/30 bg-[radial-gradient(circle_at_35%_30%,#4b8fc7,#102d52_46%,#071526_72%)] shadow-[0_0_50px_rgba(47,139,255,0.24)]"
              aria-hidden="true"
            />
            <p className="mt-5 text-sm leading-6 text-slate-200" role="status">
              {metadataUnavailable
                ? "Language destinations are temporarily unavailable. Please try again soon."
                : "Language destinations will appear here as geographic information becomes available."}
            </p>
          </div>
        )}

        {languages.length > 0 ? (
          <nav className="mx-auto mt-10 max-w-5xl" aria-label="Video languages">
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {languages.map((language) => (
                <li key={language.id}>
                  <Link
                    href={language.href as Route}
                    className="flex min-h-14 items-center justify-between gap-4 rounded-xl border border-white/16 bg-slate-950/78 px-4 py-3 text-white shadow-lg backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-sky-200/60 hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold">
                        {language.nativeLabel}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-300">
                        {language.englishLabel}
                      </span>
                    </span>
                    <span className="text-lg text-sky-200" aria-hidden="true">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </section>
  )
}
