/**
 * Guards the Watch surface against re-introducing full-document navigation.
 *
 * A raw `<a href>` pointing at an in-app path makes the browser tear the
 * document down and re-execute the whole client bundle before anything
 * paints. Measured on production before this guard existed: 2,284 ms to first
 * paint for a card click, against 56 ms once the same destination went through
 * `next/link` with its destination prefetched. Only 15 KB crossed the wire in
 * the slow case — the cost was re-parsing ~3 MB of already-cached JavaScript.
 *
 * No type or lint rule catches this. A raw anchor with a correct href
 * type-checks, renders the right URL, passes an href assertion, and works when
 * clicked. It is only slow. So the seam needs a whole-source backstop.
 *
 * WHAT THIS ALLOWS, and why each is not in-app navigation:
 *   - `target="_blank"`      leaves the app by definition
 *   - `download`             a file transfer, not a route change
 *   - an absolute URL literal (`https:`, `mailto:`, `tel:`) — another origin
 *   - a fragment literal (`#top`) — same document, no navigation
 *
 * Everything else must be `next/link`, or carry an entry in
 * `KNOWN_RAW_NAVIGATION_ANCHORS` naming why it has not converted yet.
 *
 * If this test fails on a file you just touched, the fix is almost always to
 * use `next/link` — not to add an allowlist entry. Note that `next/link`
 * prepends the `/watch` basePath itself, so the href you pass it must be
 * base-path-RELATIVE; hand-prefixing renders `/watch/watch/...`.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative as relativePath } from "node:path"

import { describe, expect, it } from "vitest"

const APP_ROOT = join(__dirname, "..")

/**
 * Files that still navigate through a raw anchor. Each entry is a debt
 * record, not a blessing: the count pins how many exist so a NEW one in an
 * already-listed file still fails.
 */
const KNOWN_RAW_NAVIGATION_ANCHORS: Record<
  string,
  { count: number; reason: string }
> = {
  "components/home/WatchHomeFooter.tsx": {
    count: 2,
    reason:
      "Not in-app navigation. Both hrefs are computed but every value is an absolute https://www.jesusfilm.org/... URL (see FOOTER_LINKS and giveNowHref), so they leave the Watch app the same way the literal footer links do. Listed only because the guard cannot prove a computed href is absolute.",
  },
  "components/sections/MediaCollection.tsx": {
    count: 1,
    reason:
      "Rail CTA. Its destination is admin-authored, so converting it needs the destination classifier applied and an external-vs-internal split, the way WatchHomeCategoryRail does it.",
  },
  "components/sections/CTASection.tsx": {
    count: 1,
    reason: "Authored buttonLink; same conversion as the MediaCollection CTA.",
  },
  "components/sections/PromoBanner.tsx": {
    count: 1,
    reason: "Authored ctaLink; same conversion as the MediaCollection CTA.",
  },
  "components/sections/VideoHero.tsx": {
    count: 1,
    reason: "Authored ctaLink; same conversion as the MediaCollection CTA.",
  },
  "components/sections/Text.tsx": {
    count: 1,
    reason:
      "Authored rich-text link. Can be internal or external, so it needs the classifier before it can become a Link.",
  },
}

/** Opening `<a ...>` tags, including ones whose attributes span lines. */
const ANCHOR_TAG = /<a\s([^>]*?)\/?>/gs

/** A quoted string attribute value: href="..." or href={"..."} */
function literalHref(attrs: string): string | null {
  const doubleQuoted = attrs.match(/\bhref="([^"]*)"/)
  if (doubleQuoted) return doubleQuoted[1]
  const braced = attrs.match(/\bhref=\{\s*["'`]([^"'`]*)["'`]\s*\}/)
  if (braced) return braced[1]
  return null
}

function isNonNavigating(attrs: string): boolean {
  // Leaves the app.
  if (/\btarget=/.test(attrs)) return true
  // Transfers a file rather than changing route.
  if (/\bdownload\b/.test(attrs)) return true

  const href = literalHref(attrs)
  if (href == null) return false // computed — cannot prove it is safe
  // Another origin, or a scheme that is not a page load.
  if (/^(https?:|mailto:|tel:)/i.test(href)) return true
  // Same document.
  if (href.startsWith("#")) return true
  return false
}

type Finding = { file: string; line: number; snippet: string }

/** Every non-test `.tsx` under the app, as paths relative to `APP_ROOT`. */
function collectComponentFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue
      collectComponentFiles(full, out)
      continue
    }
    if (!entry.name.endsWith(".tsx")) continue
    if (entry.name.includes(".test.") || entry.name.includes(".stories."))
      continue
    out.push(relativePath(APP_ROOT, full))
  }
  return out
}

function findRawNavigationAnchors(): Finding[] {
  const files = collectComponentFiles(APP_ROOT)

  const findings: Finding[] = []
  for (const relative of files) {
    const source = readFileSync(join(APP_ROOT, relative), "utf8")
    for (const match of source.matchAll(ANCHOR_TAG)) {
      const attrs = match[1]
      if (!/\bhref\b/.test(attrs)) continue
      if (isNonNavigating(attrs)) continue
      findings.push({
        file: relative,
        line: source.slice(0, match.index).split("\n").length,
        snippet: attrs.replace(/\s+/g, " ").trim().slice(0, 100),
      })
    }
  }
  return findings
}

describe("in-app navigation goes through next/link", () => {
  it("has no unaccounted raw anchor navigating to an in-app path", () => {
    const findings = findRawNavigationAnchors()

    const byFile = new Map<string, Finding[]>()
    for (const finding of findings) {
      const list = byFile.get(finding.file) ?? []
      list.push(finding)
      byFile.set(finding.file, list)
    }

    const unexpected: string[] = []
    for (const [file, list] of byFile) {
      const allowed = KNOWN_RAW_NAVIGATION_ANCHORS[file]
      if (allowed == null) {
        unexpected.push(
          `${file} — ${list.length} raw navigation anchor(s), none expected:\n` +
            list
              .map((f) => `      line ${f.line}: <a ${f.snippet}>`)
              .join("\n"),
        )
        continue
      }
      if (list.length > allowed.count) {
        unexpected.push(
          `${file} — ${list.length} raw navigation anchors, only ${allowed.count} accounted for.\n` +
            `      Known debt: ${allowed.reason}\n` +
            list
              .map((f) => `      line ${f.line}: <a ${f.snippet}>`)
              .join("\n"),
        )
      }
    }

    expect(
      unexpected,
      unexpected.length === 0
        ? ""
        : `\nRaw <a href> to an in-app path re-executes the whole JS bundle on click.\n` +
            `Use next/link instead (pass a base-path-RELATIVE href — Link adds /watch itself).\n\n` +
            unexpected.join("\n\n") +
            `\n`,
    ).toEqual([])
  })

  /**
   * Keeps the allowlist from outliving its debt. If a listed file converts to
   * `next/link` and nobody removes its entry, the allowlist silently starts
   * permitting a future regression in that file.
   */
  it("has no stale allowlist entry", () => {
    const findings = findRawNavigationAnchors()
    const counts = new Map<string, number>()
    for (const finding of findings) {
      counts.set(finding.file, (counts.get(finding.file) ?? 0) + 1)
    }

    const stale = Object.entries(KNOWN_RAW_NAVIGATION_ANCHORS)
      .filter(([file, { count }]) => (counts.get(file) ?? 0) < count)
      .map(
        ([file, { count }]) =>
          `${file} — allowlisted ${count}, found ${counts.get(file) ?? 0}. Lower the count or delete the entry.`,
      )

    expect(stale).toEqual([])
  })
})
