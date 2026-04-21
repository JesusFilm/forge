"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { generateExperienceAction } from "@/app/demo-search/actions"
import { subscribeToGenerateRequests } from "@/lib/demo-generate-bus"
import type {
  Experience,
  ExperienceGeneratorErrorCode,
} from "@/lib/experience-generator"
import type { SearchResult } from "@/lib/search"
import { GeneratedSection } from "./GeneratedSections"

const OUTPUT_ELEMENT_ID = "ai-generated-output"

type AiExperienceGeneratorDemoProps = {
  query: string
  results: SearchResult[]
}

type GenState =
  | { status: "idle" }
  | { status: "success"; experience: Experience; latencyMs: number }
  | {
      status: "error"
      code: ExperienceGeneratorErrorCode
      message: string
    }

const MAX_RESULTS_FOR_PROMPT = 10

function formatSeconds(ms: number): string {
  const seconds = ms / 1000
  return seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48)
}

export function AiExperienceGeneratorDemo({
  query,
  results,
}: AiExperienceGeneratorDemoProps) {
  const [state, setState] = useState<GenState>({ status: "idle" })
  const [isPending, startTransition] = useTransition()
  // `run` captures current query + results in a closure, so we hold the
  // latest copy in a ref for the bus subscription (which is set up once
  // on mount).
  const runRef = useRef<() => void>(() => {})

  const resultsBySlug = useMemo(
    () => new Map(results.map((r) => [r.slug, r])),
    [results],
  )

  function run() {
    if (isPending) return
    const compact = results.slice(0, MAX_RESULTS_FOR_PROMPT).map((r) => ({
      slug: r.slug,
      title: r.title ?? r.slug,
      snippet: r.snippet ?? "",
    }))
    startTransition(async () => {
      const outcome = await generateExperienceAction({
        query,
        results: compact,
      })
      if (outcome.ok) {
        setState({
          status: "success",
          experience: outcome.experience,
          latencyMs: outcome.latencyMs,
        })
      } else {
        setState({
          status: "error",
          code: outcome.code,
          message: outcome.message,
        })
      }
    })
  }
  useEffect(() => {
    runRef.current = run
  })

  useEffect(() => {
    return subscribeToGenerateRequests(() => runRef.current())
  }, [])

  // Smooth-scroll the generated preview into view once it lands.
  useEffect(() => {
    if (state.status !== "success") return
    const node = document.getElementById(OUTPUT_ELEMENT_ID)
    if (!node) return
    // Defer a frame so layout settles (images / fonts) before the scroll.
    const timer = window.setTimeout(() => {
      node.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 50)
    return () => window.clearTimeout(timer)
  }, [state])

  const buttonLabel = isPending
    ? "Composing…"
    : state.status === "success"
      ? "Regenerate"
      : "Generate experience with AI"

  return (
    <section
      aria-label="AI-generated experience preview"
      className="mt-12 rounded-3xl border border-amber-900/40 bg-gradient-to-b from-amber-950/20 to-stone-950/40 p-6 md:p-8"
    >
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-amber-400 uppercase">
          Live agent demo
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white md:text-3xl">
          Feed the search results to an agent → get a web page
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-stone-300">
          gpt-4o-mini reads the results above, picks a spotlight, groups themes,
          and adds scripture — structured output, real slugs only.
        </p>
      </header>

      <ComparisonStrip
        latencyMs={state.status === "success" ? state.latencyMs : null}
      />

      <div className="mt-6 mb-4 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-stone-950 transition hover:bg-amber-400 disabled:cursor-wait disabled:opacity-70"
        >
          {isPending && (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {buttonLabel}
        </button>
        <span className="text-xs text-stone-500">
          Each run ≈ $0.001 · gpt-4o-mini via OpenRouter
        </span>
      </div>

      {state.status === "error" && (
        <div className="mx-auto max-w-2xl rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-center text-sm text-red-200">
          {state.message}
        </div>
      )}

      {state.status === "success" && (
        <BrowserFrame
          id={OUTPUT_ELEMENT_ID}
          latencyMs={state.latencyMs}
          url={`jesusfilm.org/watch/${slugify(state.experience.title)}`}
        >
          <article className="p-6 md:p-10">
            <header className="mb-8 border-b border-stone-800 pb-6">
              <p className="text-[10px] font-semibold tracking-[0.25em] text-amber-400 uppercase">
                AI-generated experience
              </p>
              <h3 className="mt-3 text-3xl font-semibold text-white md:text-4xl">
                {state.experience.title}
              </h3>
              <p className="mt-4 text-base leading-relaxed text-stone-300">
                {state.experience.intro}
              </p>
            </header>
            <div className="flex flex-col gap-10">
              {state.experience.sections.map((section, idx) => (
                <GeneratedSection
                  key={`${section.type}-${idx}`}
                  section={section}
                  resultsBySlug={resultsBySlug}
                />
              ))}
            </div>
          </article>
        </BrowserFrame>
      )}
    </section>
  )
}

function ComparisonStrip({ latencyMs }: { latencyMs: number | null }) {
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-stone-800 bg-stone-950/60 p-4 text-center">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-stone-500 uppercase">
          Human team, by hand
        </p>
        <p className="mt-2 text-2xl font-semibold text-stone-300 tabular-nums">
          2–3 weeks
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Write copy · hunt for videos · assemble layout · review
        </p>
      </div>
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-center">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-amber-400 uppercase">
          Agent + this API
        </p>
        <p className="mt-2 text-2xl font-semibold text-white tabular-nums">
          {latencyMs == null ? "2–3 minutes" : `${formatSeconds(latencyMs)} s`}
        </p>
        <p className="mt-1 text-xs text-stone-400">
          {latencyMs == null
            ? "Semantic search + LLM composition in one pass"
            : "This run, just now"}
        </p>
      </div>
    </div>
  )
}

function BrowserFrame({
  id,
  url,
  latencyMs,
  children,
}: {
  id?: string
  url: string
  latencyMs: number
  children: React.ReactNode
}) {
  return (
    <div
      id={id}
      className="mx-auto mt-4 scroll-mt-6 overflow-hidden rounded-2xl border border-stone-800 bg-stone-950 shadow-2xl shadow-black/40"
    >
      <div className="flex items-center gap-3 border-b border-stone-800 bg-stone-900 px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-red-500/70" />
          <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
          <span className="h-3 w-3 rounded-full bg-green-500/70" />
        </div>
        <div className="flex-1 rounded-md bg-stone-950 px-3 py-1 text-center font-mono text-xs text-stone-400">
          {url}
        </div>
        <span className="hidden rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300 uppercase sm:inline">
          Generated in {formatSeconds(latencyMs)}s
        </span>
      </div>
      {children}
    </div>
  )
}
