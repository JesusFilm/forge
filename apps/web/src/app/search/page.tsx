import type { Metadata } from "next"
import { Suspense } from "react"
import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"
import { searchVideos, type SearchError } from "@/lib/search"
import { SearchInput } from "@/components/search/SearchInput"
import { SearchResults } from "@/components/search/SearchResults"

type PageProps = {
  searchParams: Promise<{ q?: string }>
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const { q } = await searchParams
  return {
    title: q ? `Search: ${q}` : "Search",
  }
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams
  const query = q?.trim() ?? ""

  return (
    <main className="min-h-screen bg-stone-900">
      <div className={`${CONTENT_WIDTH_CLASSES} py-8`}>
        <SearchInput defaultValue={query} />

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
              <SearchResultsLoader query={query} />
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
                Search for videos about any topic
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

async function SearchResultsLoader({ query }: { query: string }) {
  try {
    const { results, hasMore } = await searchVideos(query)

    return (
      <SearchResults
        key={query}
        initialResults={results}
        initialHasMore={hasMore}
        query={query}
      />
    )
  } catch (err) {
    const error = err as SearchError
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-semibold text-red-400">
          {error.message ?? "Something went wrong"}
        </p>
        <p className="mt-2 text-sm text-stone-400">
          Please try again later
          {error.retryAfterSeconds != null &&
            ` (retry in ${error.retryAfterSeconds}s)`}
        </p>
      </div>
    )
  }
}
