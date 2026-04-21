import { CONTENT_WIDTH_CLASSES } from "@/lib/content-width"

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-stone-800">
      <div className="aspect-video w-full animate-pulse bg-stone-700" />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-4 w-3/4 animate-pulse rounded bg-stone-700" />
        <div className="h-3 w-full animate-pulse rounded bg-stone-700" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-stone-700" />
      </div>
    </div>
  )
}

export default function SearchLoading() {
  return (
    <main className="min-h-screen bg-stone-900">
      <div className={`${CONTENT_WIDTH_CLASSES} py-8`}>
        {/* Search input skeleton */}
        <div className="mb-8 h-12 w-full animate-pulse rounded-xl bg-stone-800" />

        {/* Grid of card skeletons */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </main>
  )
}
