import { type MouseEvent, type SyntheticEvent } from "react"

import { ChevronRightIcon } from "@/components/shell/icons"
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

// The url is corpus-verbatim and may be any junk string; only a parseable URL
// can identify a source for dedupe purposes.
function isParseableUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

// Dedupe key: the exact url string, first occurrence wins (feat-269 — the same
// article cited N times in one turn collapses to one entry). Unparseable urls
// ("", "N/A", …) identify nothing, so distinct unlinked sources all render.
function dedupeByUrl(sources: SeekerSource[]): SeekerSource[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (!isParseableUrl(source.url)) return true
    if (seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
}

// Opening the section at the bottom of the transcript reveals content below the
// fold (and under the composer fade); nudge it into view. scrollIntoView
// respects the scroller's scroll-padding, and jsdom lacks the method entirely.
function handleSectionToggle(event: SyntheticEvent<HTMLDetailsElement>) {
  const details = event.currentTarget
  if (details.open && typeof details.scrollIntoView === "function") {
    details.scrollIntoView({ block: "nearest" })
  }
}

// The snippet lives inside its summary, so a click that ends a select-to-copy
// drag would collapse the passage being copied — suppress the toggle while a
// text selection is active (summary activation is the click's default action).
function handleSnippetSummaryClick(event: MouseEvent<HTMLElement>) {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) event.preventDefault()
}

type SourcesListProps = {
  sources: SeekerSource[]
}

/**
 * Renders the cited passages for a Seeker turn as a collapsed-by-default
 * "Sources · N" disclosure (feat-269) — the answer stays primary; grounding is
 * one interaction away. Entries are deduped by URL, each a compact card whose
 * snippet is clamped to three lines behind its own per-source disclosure.
 * The empty state stays an explicit, always-visible "No sources cited" line
 * (never a blank container, never behind an interaction).
 */
export function SourcesList({ sources }: SourcesListProps) {
  if (sources.length === 0) {
    return (
      <p className="mt-2 text-sm text-ash italic" data-sources="empty">
        No sources cited
      </p>
    )
  }

  const entries = dedupeByUrl(sources)

  return (
    <details
      className="group/sources mt-2"
      data-sources="section"
      onToggle={handleSectionToggle}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-ash transition-colors duration-300 hover:text-linen [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 transition-transform duration-300 group-open/sources:rotate-90" />
        Sources · {entries.length}
      </summary>
      <ul
        className="mt-2 flex flex-col gap-3 border-l border-linen/10 pl-3"
        data-sources="list"
      >
        {entries.map((source, index) => {
          const label = source.title ?? source.sourceName
          const linked = isHttpsUrl(source.url)
          return (
            <li
              key={`${source.url}-${index}`}
              data-source-index={index}
              className="text-sm text-ash"
            >
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
                // The details body is intentionally empty — the summary holds
                // the snippet, and open-state presentation (clamp release,
                // label swap) is driven entirely by group-open variants.
                <details className="group/snippet mt-0.5">
                  <summary
                    onClick={handleSnippetSummaryClick}
                    className="block cursor-pointer list-none [&::-webkit-details-marker]:hidden"
                  >
                    {/* No `block` here: line-clamp-3 needs its own
                        display:-webkit-box, which a display utility would
                        override (and silently unclamp). */}
                    <span
                      data-source-snippet
                      className="line-clamp-3 text-ash group-open/snippet:line-clamp-none"
                    >
                      {source.snippet}
                    </span>
                    <span className="mt-0.5 inline-block text-xs text-ash/70 underline underline-offset-2 hover:text-linen">
                      <span className="group-open/snippet:hidden">
                        Show full passage
                      </span>
                      <span className="hidden group-open/snippet:inline">
                        Show less
                      </span>
                    </span>
                  </summary>
                </details>
              ) : null}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
