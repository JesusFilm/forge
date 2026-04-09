function SkeletonCard() {
  return (
    <div className="flex animate-pulse flex-col overflow-hidden rounded-lg bg-stone-800">
      <div className="aspect-video w-full bg-stone-700" />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-4 w-3/4 rounded bg-stone-700" />
        <div className="h-3 w-full rounded bg-stone-700" />
        <div className="h-3 w-2/3 rounded bg-stone-700" />
        <div className="mt-1 flex gap-1">
          <div className="h-5 w-14 rounded-full bg-stone-700" />
          <div className="h-5 w-16 rounded-full bg-stone-700" />
        </div>
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <main className="min-h-screen bg-stone-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 lg:px-10">
        <div className="mb-8 flex items-center justify-between">
          <div className="h-4 w-40 animate-pulse rounded bg-stone-700" />
          <div className="flex gap-2">
            <div className="h-8 w-12 animate-pulse rounded-full bg-stone-700" />
            <div className="h-8 w-12 animate-pulse rounded-full bg-stone-700" />
            <div className="h-8 w-12 animate-pulse rounded-full bg-stone-700" />
          </div>
        </div>

        <div className="flex flex-col gap-6 md:flex-row">
          <div className="aspect-video w-full animate-pulse rounded-lg bg-stone-800 md:w-1/2" />
          <div className="flex flex-col gap-3 md:w-1/2">
            <div className="h-8 w-3/4 animate-pulse rounded bg-stone-700" />
            <div className="h-4 w-full animate-pulse rounded bg-stone-700" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-stone-700" />
          </div>
        </div>

        <div className="mt-10">
          <div className="mb-6 h-6 w-48 animate-pulse rounded bg-stone-700" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
