/**
 * Thin content extraction — HTML → { title, text }, scoped to a source's
 * `contentSelectors` with its `stripSelectors` removed first (nav/sidebar/
 * footer/share/comments). Produces extracted MAIN TEXT only; it does NOT clean,
 * tag, or chunk — that is Indexing's job (docs/architecture.md §2/§3). Uses
 * node-html-parser (a pure transform; the I/O Fetcher stays injected).
 */
import { parse, type HTMLElement } from "node-html-parser"
export interface CrawlPolicy {
  contentSelectors: readonly string[]
  stripSelectors: readonly string[]
}

export interface Extracted {
  title: string | null
  text: string
}

/**
 * Normalize block text into clean paragraphs: node-html-parser separates block
 * elements with a single newline, so collapse intra-line whitespace (incl.
 * &nbsp;), drop empty lines, and rejoin blocks with a blank line — giving the
 * paragraph boundaries Indexing's chunker relies on (invariant 4).
 */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n\n")
    .trim()
}

/** Page title: the <title> tag with a trailing " | Site"/" - Site" suffix trimmed; falls back to the first <h1>. */
function extractTitle(root: HTMLElement): string | null {
  const raw = root.querySelector("title")?.text?.trim()
  // Require whitespace BEFORE the separator so a hyphenated final word
  // ("Self-Aware", "Christ-Centered") isn't mistaken for a " - Site" suffix.
  if (raw) return raw.replace(/\s+[|–—-]\s*[^|–—-]{1,60}$/, "").trim() || raw
  return root.querySelector("h1")?.text?.trim() || null
}

export function extractContent(html: string, policy: CrawlPolicy): Extracted {
  const root = parse(html)
  const title = extractTitle(root)

  let scope: HTMLElement | null = null
  for (const selector of policy.contentSelectors) {
    scope = root.querySelector(selector)
    if (scope) break
  }
  const container = scope ?? root.querySelector("body") ?? root

  for (const selector of policy.stripSelectors) {
    for (const el of container.querySelectorAll(selector)) el.remove()
  }

  return { title, text: tidy(container.structuredText) }
}
