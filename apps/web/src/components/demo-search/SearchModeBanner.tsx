type SearchModeBannerProps = {
  mode: string | null | undefined
}

export function SearchModeBanner({ mode }: SearchModeBannerProps) {
  if (mode !== "keyword-only") return null
  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-amber-900/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200"
    >
      <strong className="font-semibold">
        Semantic search is unavailable right now.
      </strong>{" "}
      Results below are keyword-matched only — scene-level thematic matches (our
      normal best-quality hits) will return once the embedding provider is
      reachable again.
    </div>
  )
}
