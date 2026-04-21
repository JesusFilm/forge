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
  const query = q?.trim() ?? ""

  return (
    <main className="min-h-screen bg-stone-900">
      <div className={`${CONTENT_WIDTH_CLASSES} py-8`}>
        <header className="mb-6">
          <p className="text-xs font-medium tracking-wider text-stone-500 uppercase">
            Search demo
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white md:text-3xl">
            Semantic search over 955+ JesusFilm videos
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-400">
            This page hits our live semantic-search API (pgvector + OpenRouter
            embeddings) instead of the Algolia-backed search on{" "}
            <a
              href="https://www.jesusfilm.org/watch"
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-stone-600 underline-offset-2 hover:text-stone-200"
            >
              www.jesusfilm.org/watch
            </a>
            . Try a thematic query like &ldquo;forgiveness,&rdquo;
            &ldquo;Easter,&rdquo; or a full sentence — up to 200 characters.
          </p>
        </header>

        <DemoSearchInput defaultValue={query} />

        <div className="mt-8">
          {query ? (
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
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <svg
                className="mb-4 h-16 w-16 text-stone-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <p className="text-lg text-stone-400">
                Type a query above to search
              </p>
            </div>
          )}
        </div>

        <CostLatencyPanel />
      </div>
    </main>
  )
}

async function DemoResultsLoader({ query }: { query: string }) {
  const data = await searchVideos(query).catch((err) => ({
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
        <AiExperienceGeneratorDemo query={query} results={data.results} />
      )}
    </>
  )
}
