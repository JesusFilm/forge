// Pure single-pass canonicalizer for the /watch URL space. No loops, no
// re-entry, no shared state. Each rule applied at most once in fixed order;
// each rule is idempotent in isolation. Therefore canonicalize is a
// fixed-point and canonicalize(canonicalize(x).pathname) === { kind: "canonical" }.
// Property test asserts this for every URL in
// docs/research/jesusfilm-watch-url-patterns.md §5 and every alias-table key.
//
// Operates on the RAW (un-decoded) pathname to preserve percent-encoding;
// the WHATWG URL parser silently re-encodes reserved chars and we don't
// want that surface in the state machine. `pathname` arrives with the
// basePath already stripped (Next 16 proxy.ts semantics).

import { tryResolveLanguageAlias } from "./language-aliases"
import { HTML_SUFFIX, hasHtmlSuffix } from "./url-shape"

export type CanonicalizeResult =
  | { kind: "canonical" }
  | {
      kind: "redirect"
      pathname: string
      status: 307 | 308
      cache: "no-store" | "short" | "long"
    }

export type CanonicalizeInput = {
  rawPathname: string
}

const MAX_PATH_LEN = 2048

// Tightened to `_next` (not `_next/static`) so RSC payloads (`_next/data`),
// image optimizer (`_next/image`), and webpack-hmr all bypass canonicalize.
// Defense-in-depth alongside the proxy.ts matcher.
const RESERVED_PREFIXES = new Set([
  "api",
  "_next",
  "assets",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
])

// Literals that MUST NOT trigger Rule 5 (single-segment-duplicate). These are
// served as 1-segment routes directly (videos index, search results). Every
// other 1-segment slug is treated as legacy and duplicate-expanded.
const ONE_SEGMENT_EXEMPT = new Set(["videos", "search"])

// Origin-invariance + injection guards. Any input that fails MUST short-circuit
// to `{kind: "canonical"}` (let the route handler 404 it). NEVER emit a
// Location derived from a path that could escape origin (// at start, \, CRLF,
// percent-encoded CRLF) or carry traversal (.. segments).
const UNSAFE_INPUT = /(^\/\/)|[\\\r\n]|(%0[ad])/i

const HTML_SUFFIX_LOWER = HTML_SUFFIX // ".html"
const HTML_SUFFIX_REGEX_GI = /\.html(?=\/|$)/gi

export function canonicalizeWatchPath(
  input: CanonicalizeInput,
): CanonicalizeResult {
  const raw = input.rawPathname

  // 0a: length cap (ReDoS defense)
  if (raw.length > MAX_PATH_LEN) return { kind: "canonical" }

  // 0b: reserved subtree exclusion
  const firstSegment = raw.split("/").filter(Boolean)[0]
  if (firstSegment && RESERVED_PREFIXES.has(firstSegment)) {
    return { kind: "canonical" }
  }

  // 0c: injection guard — origin invariance + CRLF + traversal
  if (UNSAFE_INPUT.test(raw)) return { kind: "canonical" }
  if (raw.split("/").some((seg) => seg === "..")) {
    return { kind: "canonical" }
  }

  // Run rules. Each is a pure function (path → path) that no-ops when input
  // doesn't match. After all rules, if path !== raw, emit ONE redirect with
  // status and cache intent computed from which rules fired.
  let path = raw
  let onlyTrailingSlashChanged = true

  // Rule 1: trailing-slash strip → 308
  if (path !== "/" && path.endsWith("/")) {
    path = path.slice(0, -1)
  }
  // (preserve onlyTrailingSlashChanged = true if only this fired)

  // Rule 2: lowercase ".HTML" suffix (case-insensitive match → lowercase replace)
  if (HTML_SUFFIX_REGEX_GI.test(path)) {
    const lowered = path.replace(HTML_SUFFIX_REGEX_GI, HTML_SUFFIX_LOWER)
    if (lowered !== path) {
      path = lowered
      onlyTrailingSlashChanged = false
    }
  }

  // Rule 3: legacy 4-segment episode shape rewrite.
  // /{series}/{ep}.html/{lang}.html → /{series}.html/{ep}/{lang}.html
  // Detect: 3 segments, segments[0] bare, segments[1] + segments[2] both .html.
  {
    const segs = path.split("/").filter(Boolean)
    if (
      segs.length === 3 &&
      !hasHtmlSuffix(segs[0]) &&
      hasHtmlSuffix(segs[1]) &&
      hasHtmlSuffix(segs[2])
    ) {
      const newSegs = [
        `${segs[0]}${HTML_SUFFIX_LOWER}`,
        segs[1].replace(/\.html$/i, ""),
        segs[2],
      ]
      path = `/${newSegs.join("/")}`
      onlyTrailingSlashChanged = false
    }
  }

  // Rule 4: per-segment .html append (segment-count-aware).
  // 2-segment: append to both. 3-segment: append to segments [0] and [2] only
  // (episode segment stays bare per production contract).
  {
    const segs = path.split("/").filter(Boolean)
    if (segs.length === 2) {
      const next = segs.map((s) =>
        hasHtmlSuffix(s) ? s : `${s}${HTML_SUFFIX_LOWER}`,
      )
      const candidate = `/${next.join("/")}`
      if (candidate !== path) {
        path = candidate
        onlyTrailingSlashChanged = false
      }
    } else if (segs.length === 3) {
      const next = [
        hasHtmlSuffix(segs[0]) ? segs[0] : `${segs[0]}${HTML_SUFFIX_LOWER}`,
        segs[1],
        hasHtmlSuffix(segs[2]) ? segs[2] : `${segs[2]}${HTML_SUFFIX_LOWER}`,
      ]
      const candidate = `/${next.join("/")}`
      if (candidate !== path) {
        path = candidate
        onlyTrailingSlashChanged = false
      }
    }
  }

  // Rule 4.5: enforce 3-segment episode-bare contract. In the canonical
  // /{series}.html/{episode}/{lang}.html shape the middle segment must be
  // bare. Strip .html from segment 1 if present so the malformed shape
  // /series.html/ep.html/lang.html redirects to the canonical form.
  {
    const segs = path.split("/").filter(Boolean)
    if (segs.length === 3 && hasHtmlSuffix(segs[1])) {
      const next = [segs[0], segs[1].replace(/\.html$/i, ""), segs[2]]
      const candidate = `/${next.join("/")}`
      if (candidate !== path) {
        path = candidate
        onlyTrailingSlashChanged = false
      }
    }
  }

  // Rule 5: single-segment-no-.html → duplicate-with-.html.
  // /foo → /foo.html/foo.html. Skip whitelist (videos, search) which are
  // legitimate 1-segment routes.
  {
    const segs = path.split("/").filter(Boolean)
    if (
      segs.length === 1 &&
      !hasHtmlSuffix(segs[0]) &&
      !ONE_SEGMENT_EXEMPT.has(segs[0])
    ) {
      path = `/${segs[0]}${HTML_SUFFIX_LOWER}/${segs[0]}${HTML_SUFFIX_LOWER}`
      onlyTrailingSlashChanged = false
    }
  }

  // Rule 6: language-slug alias resolution on the locale segment.
  // 2-segment: alias applies to segments[1]. 3-segment: applies to segments[2].
  {
    const segs = path.split("/").filter(Boolean)
    const localeIdx = segs.length === 2 ? 1 : segs.length === 3 ? 2 : -1
    if (localeIdx >= 0 && hasHtmlSuffix(segs[localeIdx])) {
      const bare = segs[localeIdx].replace(/\.html$/i, "")
      const canonical = tryResolveLanguageAlias(bare)
      if (canonical && canonical !== bare) {
        segs[localeIdx] = `${canonical}${HTML_SUFFIX_LOWER}`
        path = `/${segs.join("/")}`
        onlyTrailingSlashChanged = false
      }
    }
  }

  if (path === raw) return { kind: "canonical" }

  // Defense-in-depth: re-check origin-invariance on the output. Any rule
  // composition that synthesized an unsafe Location MUST be rejected.
  if (UNSAFE_INPUT.test(path)) return { kind: "canonical" }
  if (!path.startsWith("/") || path.startsWith("//")) {
    return { kind: "canonical" }
  }

  return {
    kind: "redirect",
    pathname: path,
    status: onlyTrailingSlashChanged ? 308 : 307,
    cache: onlyTrailingSlashChanged ? "long" : "short",
  }
}
