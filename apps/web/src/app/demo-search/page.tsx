import type { Metadata } from "next"
import { Suspense } from "react"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
import { searchVideos, type SearchError } from "@/lib/search"
import { AiExperienceGeneratorDemo } from "@/components/demo-search/AiExperienceGeneratorDemo"
import { CostLatencyPanel } from "@/components/demo-search/CostLatencyPanel"
import { DemoSearchInput } from "@/components/demo-search/DemoSearchInput"
import { DemoSearchResults } from "@/components/demo-search/DemoSearchResults"
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
  const query = q?.trim() || DEFAULT_QUERY

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

        <DemoSearchInput defaultValue={query} />

        <div className="mt-8">
          <Suspense
            fallback={
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div
                    key={i}
                    className="overflow-hidden rounded-2xl bg-stone-800"
                  >
                    <div className="aspect-video w-full animate-pulse bg-stone-700" />
                    <div className="flex flex-col gap-2 p-3">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-stone-700" />
                      <div className="h-3 w-full animate-pulse rounded bg-stone-700" />
                    </div>
                  </div>
                ))}
              </div>
            }
          >
            <DemoResultsLoader query={query} />
          </Suspense>
        </div>

        <CostLatencyPanel />
      </div>
    </main>
  )
}

// Small initial page so the AI generator section sits above the fold next to
// the raw material it operates on. "Load more" still fetches additional
// results client-side.
const INITIAL_RESULTS_LIMIT = 8

async function DemoResultsLoader({ query }: { query: string }) {
  const data = await searchVideos(query, INITIAL_RESULTS_LIMIT).catch(
    (err) => ({
      error: err as SearchError,
    }),
  )

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

  return (
    <>
      <SearchModeBanner mode={data.searchMode} />
      <DemoSearchResults
        key={query}
        initialResults={data.results}
        initialHasMore={data.hasMore}
        query={query}
        initialLatencyMs={data.latencyMs}
      />
      {data.results.length > 0 && (
        <AiExperienceGeneratorDemo
          key={query}
          query={query}
          results={data.results}
        />
      )}
    </>
  )
}
