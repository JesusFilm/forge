"use client"

export default function SearchError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="text-lg font-semibold text-stone-100">
        Something went wrong
      </h2>
      <p className="mt-2 text-sm text-stone-400">
        {error.message || "An unexpected error occurred while searching."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg bg-stone-800 px-6 py-3 text-sm font-medium text-stone-200 transition hover:bg-stone-700"
      >
        Try again
      </button>
    </div>
  )
}
