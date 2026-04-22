import type { Metadata } from "next"
import { Suspense } from "react"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
import { searchVideos, type SearchError } from "@/lib/search"
import {
  AiDemoHeader,
  AiExperienceGeneratorDemo,
  ComparisonStrip,
} from "@/components/demo-search/AiExperienceGeneratorDemo"
import { CostLatencyPanel } from "@/components/demo-search/CostLatencyPanel"
import { DemoSearchInput } from "@/components/demo-search/DemoSearchInput"
import { DemoSearchResults } from "@/components/demo-search/DemoSearchResults"
import { GeneratorLifecycleSentinel } from "@/components/demo-search/GeneratorLifecycleSentinel"
import { SearchModeBanner } from "@/components/demo-search/SearchModeBanner"

type PageProps = {
  searchParams: Promise<{ q?: string }>
}

// Default query for stakeholder demos — an apologetics-framed natural
// language question that shows off the semantic search better than a
// single keyword.
const DEFAULT_QUERY = "evidence of the resurrection"

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const { q } = await searchParams
  return {
    title: q ? `Demo search: ${q}` : "Semantic search demo",
    description:
      "Live demo of the JesusFilm semantic-search API, with a cost and speed comparison against the current Algolia-backed watch page search.",
    robots: { index: false, follow: false },
  }
}

export default async function DemoSearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams
  // Distinguish "user intentionally cleared the query" (q === "") from
  // "cold load with no param" (q === undefined). The former shows a
  // validation state; the latter falls back to DEFAULT_QUERY.
  const hasExplicitQuery = typeof q === "string"
  const trimmedQuery = q?.trim() ?? ""
  const isEmptyQuery = hasExplicitQuery && trimmedQuery === ""
  const query = hasExplicitQuery ? trimmedQuery : DEFAULT_QUERY
  const inputDefaultValue = hasExplicitQuery ? trimmedQuery : DEFAULT_QUERY

  return (
    <main className="min-h-screen bg-stone-900">
      <div className={`${CONTENT_WIDTH_CLASSES} py-8`}>
        <header className="mb-8">
          <p className="text-xs font-medium tracking-wider text-amber-400 uppercase">
            10× AI agents building JesusFilm experiences
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white md:text-5xl">
            Semantic search API · agent-native
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-stone-300">
            The current{" "}
            <a
              href="https://www.jesusfilm.org/watch/easter.html"
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-stone-600 underline-offset-2 hover:text-stone-200"
            >
              /watch/easter
            </a>{" "}
            experience took a human team{" "}
            <strong className="font-semibold text-white">2–3 weeks</strong> to
            write and hand-curate. An AI agent using this semantic search API
            does a comparable pass in{" "}
            <strong className="font-semibold text-amber-300">
              2–3 minutes
            </strong>
            . Type a query, then click <em>Generate</em> below.
          </p>
        </header>

        <DemoSearchInput defaultValue={inputDefaultValue} />

        <div className="mt-8">
          {isEmptyQuery ? (
            <>
              <GeneratorLifecycleSentinel key="sentinel-empty" />
              <EmptyQueryPrompt />
            </>
          ) : (
            <Suspense key={query} fallback={<AiExperienceGeneratorSkeleton />}>
              <DemoResultsLoader query={query} />
            </Suspense>
          )}
        </div>

        <CostLatencyPanel />
      </div>
    </main>
  )
}

function EmptyQueryPrompt() {
  return (
    <section
      aria-label="Enter a query to begin"
      className="mt-12 rounded-3xl border border-amber-900/40 bg-gradient-to-b from-amber-950/20 to-stone-950/40 px-6 py-16 text-center md:py-20"
    >
      <p className="text-xs font-semibold tracking-[0.2em] text-amber-400 uppercase">
        Waiting for a prompt
      </p>
      <h2 className="mt-3 text-xl font-semibold text-white md:text-2xl">
        Type a query to run the demo
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-stone-400">
        The agent needs something to search for. Try an apologetics-framed
        question (e.g.&nbsp;&ldquo;evidence of the resurrection&rdquo;) or a
        felt-need phrase (&ldquo;how do I find peace&rdquo;) in the input above.
      </p>
    </section>
  )
}

// Mirrors the resting-state shell of AiExperienceGeneratorDemo so the page
// has visible structure while the search query resolves. Button renders
// as disabled-but-idle (not a spinner) to stay visually in sync with the
// hero button above, which reads `searching=false` on cold load.
function AiExperienceGeneratorSkeleton() {
  return (
    <section
      aria-label="AI-generated experience preview"
      aria-busy="true"
      className="mt-12 rounded-3xl border border-amber-900/40 bg-gradient-to-b from-amber-950/20 to-stone-950/40 p-6 md:p-8"
    >
      <AiDemoHeader />

      <ComparisonStrip latencyMs={null} />

      <div className="mt-6 mb-4 flex flex-col items-center gap-2">
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-sm font-semibold text-stone-950 transition disabled:cursor-wait disabled:opacity-70"
        >
          Generate experience with AI
        </button>
        <span className="text-xs text-stone-500">
          Each run ≈ $0.001 · gpt-4o-mini via OpenRouter
        </span>
      </div>
    </section>
  )
}

// Small initial page so the AI generator section sits above the fold next to
// the raw material it operates on. "Load more" still fetches additional
// results client-side.
const INITIAL_RESULTS_LIMIT = 8

async function DemoResultsLoader({ query }: { query: string }) {
  const data = await searchVideos(
    query,
    INITIAL_RESULTS_LIMIT,
    0,
    "video",
  ).catch((err) => ({
    error: err as SearchError,
  }))

  if ("error" in data) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-semibold text-red-400">
          {data.error.message ?? "Something went wrong"}
        </p>
        <p className="mt-2 text-sm text-stone-400">
          Please try again later
          {data.error.retryAfterSeconds != null &&
            ` (retry in ${data.error.retryAfterSeconds}s)`}
        </p>
      </div>
    )
  }

  // Stable key on the root so React reconciliation has an explicit anchor
  // when this tree crosses the RSC → client-component prop boundary
  // (passed as `consideredVideos` into AiExperienceGeneratorDemo).
  const consideredVideos = (
    <div key="considered-videos" className="mt-10">
      <h2 className="text-xl font-semibold text-white md:text-2xl">
        Videos considered when building this experience
      </h2>
      <p className="mt-1 text-sm text-stone-400">Favours felt needs</p>
      <div className="mt-6">
        <DemoSearchResults
          key={`results-${query}`}
          initialResults={data.results}
          initialHasMore={data.hasMore}
          query={query}
          initialLatencyMs={data.latencyMs}
        />
      </div>
    </div>
  )

  return (
    <>
      <GeneratorLifecycleSentinel key={`sentinel-${query}`} />
      <SearchModeBanner mode={data.searchMode} />
      {data.results.length > 0 ? (
        <AiExperienceGeneratorDemo
          key={`ai-${query}`}
          query={query}
          results={data.results}
          consideredVideos={consideredVideos}
        />
      ) : (
        <div className="mt-12 rounded-3xl border border-stone-800 bg-stone-950/40 px-6 py-16 text-center">
          <p className="text-sm font-medium text-stone-400">
            No videos matched &ldquo;{query}&rdquo;
          </p>
          <p className="mt-2 text-xs text-stone-500">
            Try a different query above.
          </p>
        </div>
      )}
    </>
  )
}
