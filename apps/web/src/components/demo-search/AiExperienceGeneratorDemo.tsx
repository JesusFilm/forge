"use client"

import { useMemo, useState, useTransition } from "react"
import { generateExperienceAction } from "@/app/demo-search/actions"
import type {
  Experience,
  ExperienceGeneratorErrorCode,
} from "@/lib/experience-generator"
import type { SearchResult } from "@/lib/search"
import { GeneratedSection } from "./GeneratedSections"

type AiExperienceGeneratorDemoProps = {
  query: string
  results: SearchResult[]
}

type GenState =
  | { status: "idle" }
  | { status: "success"; experience: Experience }
  | {
      status: "error"
      code: ExperienceGeneratorErrorCode
      message: string
    }

const MAX_RESULTS_FOR_PROMPT = 10

export function AiExperienceGeneratorDemo({
  query,
  results,
}: AiExperienceGeneratorDemoProps) {
  const [state, setState] = useState<GenState>({ status: "idle" })
  const [isPending, startTransition] = useTransition()

  const resultsBySlug = useMemo(
    () => new Map(results.map((r) => [r.slug, r])),
    [results],
  )

  function run() {
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
        setState({ status: "success", experience: outcome.experience })
      } else {
        setState({
          status: "error",
          code: outcome.code,
          message: outcome.message,
        })
      }
    })
  }

  const buttonLabel = isPending
    ? "Composing…"
    : state.status === "success"
      ? "Regenerate"
      : "Generate experience with AI"

  return (
    <section
      aria-label="AI-generated experience preview"
      className="mt-16 rounded-2xl border border-amber-900/40 bg-gradient-to-b from-amber-950/20 to-stone-950/40 p-6 md:p-8"
    >
      <header className="mb-4 text-center">
        <p className="text-xs font-medium tracking-wider text-amber-400 uppercase">
          AI preview
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-white">
          What an agent would do with these results
        </h2>
        <p className="mt-2 text-sm text-stone-400">
          Feed the search results to gpt-4o-mini, get back a structured
          experience in ~2 seconds — using real videos from the catalog above.
        </p>
      </header>

      <div className="mb-6 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-400 disabled:cursor-wait disabled:opacity-70"
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
          Takes ~2 s · uses OpenRouter gpt-4o-mini
        </span>
      </div>

      {state.status === "error" && (
        <div className="mx-auto max-w-2xl rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-center text-sm text-red-200">
          {state.message}
        </div>
      )}

      {state.status === "success" && (
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 rounded-xl border border-stone-800 bg-stone-950/60 p-5">
            <h3 className="text-xl font-semibold text-white">
              {state.experience.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-300">
              {state.experience.intro}
            </p>
          </div>
          <div className="flex flex-col gap-5">
            {state.experience.sections.map((section, idx) => (
              <GeneratedSection
                key={`${section.type}-${idx}`}
                section={section}
                resultsBySlug={resultsBySlug}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
