import { type SeekerSource } from "@/lib/conversations"

// Source fields are UNTRUSTED (RAG-corpus-originated). Only an https: URL becomes
// a link; everything else renders as plain text (never HTML), and links carry
// rel="noopener noreferrer". This is the sole sanitization seam for sources —
// the proxy forwards them verbatim (feat-205, KTD6).
function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:"
  } catch {
    return false
  }
}

type SourcesListProps = {
  sources: SeekerSource[]
}

/**
 * Renders the cited passages for a Seeker turn, or an explicit "No sources
 * cited" state when empty (never a blank container). The grounding signal is the
 * point of the dogfood, so the empty state is first-class, not a gap.
 */
export function SourcesList({ sources }: SourcesListProps) {
  if (sources.length === 0) {
    return (
      <p className="mt-2 text-sm text-ash italic" data-sources="empty">
        No sources cited
      </p>
    )
  }

  return (
    <ul className="mt-2 flex flex-col gap-2" data-sources="list">
      {sources.map((source, index) => {
        const label = source.title ?? source.sourceName
        const linked = isHttpsUrl(source.url)
        return (
          <li key={`${source.url}-${index}`} className="text-sm text-ash">
            {linked ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-vellum underline underline-offset-2 hover:text-linen"
              >
                {label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="text-vellum">{label}</span>
            )}
            {source.snippet ? (
              <span className="mt-0.5 block text-ash">{source.snippet}</span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
