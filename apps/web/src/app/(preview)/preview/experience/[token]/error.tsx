"use client"

export default function ExperiencePreviewError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-950 px-6 text-center text-white">
      <h1 className="text-2xl font-semibold">Draft preview unavailable</h1>
      <p className="max-w-lg text-stone-300">
        The preview could not be loaded. It may have been published or
        discarded.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-white px-5 py-2 font-semibold text-black"
      >
        Try again
      </button>
    </main>
  )
}
