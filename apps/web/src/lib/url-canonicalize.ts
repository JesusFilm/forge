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
import {
  HTML_SUFFIX,
  RESERVED_PREFIXES,
  SAFE_SLUG_PATTERN,
  UNSAFE_PATH_PATTERN,
  getWatchLocaleSegmentIndex,
  hasHtmlSuffix,
  isUnsafeRedirectPath,
  stripHtmlSuffix,
} from "./url-shape"

// Cache intent the proxy translates into a Cache-Control header. `long` marks
// a permanent normalization (308); `short` marks a temporary one (307). Every
// rule here is a pure function of the path, which is what makes `long` safe to
// share across visitors. A cookie- or header-driven redirect must never be
// routed through canonicalize — it varies per visitor and MUST NOT cache.
/**
 * Result of `canonicalizeWatchPath`:
 *
 * - `{ kind: "canonical" }` — input is already in canonical form (or is
 *   excluded by guards / reserved prefix / fast-path).
 * - `{ kind: "redirect", pathname, status, cache }` — emit `Location: <pathname>`
 *   with status (308 / `long` for permanent normalizations, 307 / `short` as
 *   soon as Rule 5 contributes) and the cache intent the proxy translates into
 *   a `Cache-Control` header.
 */
export type CanonicalizeResult =
  | { kind: "canonical" }
  | {
      kind: "redirect"
      pathname: string
      status: 307 | 308
      cache: "short" | "long"
    }

/** Input to `canonicalizeWatchPath`. `rawPathname` arrives with the basePath stripped (Next 16 proxy.ts semantics) and preserves percent-encoding. */
export type CanonicalizeInput = {
  rawPathname: string
}

const MAX_PATH_LEN = 2048

// Literals that MUST NOT trigger Rule 5 (single-segment-duplicate).
// `languages` is a 1-segment index; `whats-new` is the 1-segment Watch
// product-update page; `search` is a deprecated inbound redirect into the
// global search modal; `history` is the 1-segment watch-history page the proxy
// rewrites directly. None should become a synthetic `.html` watch URL.
const ONE_SEGMENT_EXEMPT = new Set([
  "languages",
  "whats-new",
  "search",
  "history",
])
const LOCALIZED_UTILITY_SEGMENTS = new Set(["videos", "languages", "history"])

// Origin-invariance + injection guard. Any input that fails MUST short-circuit
// to `{kind: "canonical"}` (let the route handler 404 it). NEVER emit a
// Location derived from a path that could escape origin (// at start, \, CRLF,
// percent-encoded CRLF) or carry traversal (.. segments). Shared with proxy.ts
// via `UNSAFE_PATH_PATTERN` in url-shape.ts.

// Positive allowlist applied after the negative guards. Rejects any path
// containing percent-encoding, colons, query/fragment markers, or non-ASCII.
// Only ASCII URL-safe path characters survive into the rule chain.
const SAFE_PATH = /^\/[A-Za-z0-9._\-/]+$/

const HTML_SUFFIX_LOWER = HTML_SUFFIX // ".html"
const HTML_SUFFIX_REGEX_GI = /\.html(?=\/|$)/gi

/**
 * Apply the legacy-URL normalization rules in a single deterministic pass.
 * Returns a `CanonicalizeResult` the proxy translates into a redirect
 * response or a passthrough.
 *
 * Rules (in order):
 * 1. Trailing-slash strip → 308 / long.
 * 1.5. Legacy `/videos` index redirect → `/languages` → 308 / long.
 * 2. Lowercase `.HTML` → `.html` → 308 / long.
 * 3. Legacy 4-segment-shape episode rewrite → 308 / long.
 * 4. Per-segment `.html` append (segment-count-aware); language videos keep
 *    `/videos` bare → 308 / long.
 * 4.5. Strip `.html` from middle segment in 3-seg shape (episode-bare contract) → 308 / long.
 * 5. Single-segment-no-`.html` duplicate expansion → 307 / short. The one
 *    temporary rule: its synthesized target 404s for real content slugs and
 *    is due to be replaced (FGE-203 / W-070), so it must not be cached or
 *    consolidated by crawlers. Any redirect it contributes to is temporary.
 * 6. Language-slug alias resolution → 308 / long.
 *
 * Termination guarantee: each rule is idempotent, applied at most once,
 * never re-enters the sequence. Therefore `canonicalize(canonicalize(x).pathname) === { kind: "canonical" }`.
 */
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
  if (UNSAFE_PATH_PATTERN.test(raw)) return { kind: "canonical" }
  if (raw.split("/").some((seg) => seg === "..")) {
    return { kind: "canonical" }
  }

  // 0d: positive allowlist — reject any path with chars outside the safe
  // ASCII URL-path set. Closes the percent-encoded backslash / null byte /
  // scheme-prefix / non-ASCII reflection vectors that 0c didn't catch.
  if (!SAFE_PATH.test(raw)) return { kind: "canonical" }

  // Run rules. Each is a pure function (path → path) that no-ops when input
  // doesn't match. After all rules, if path !== raw, emit ONE redirect with
  // status and cache intent computed from which rules fired: permanent
  // unless a temporary rule (only Rule 5) took part.
  let path = raw
  let temporaryRuleFired = false

  // Rule 1: trailing-slash strip
  if (path !== "/" && path.endsWith("/")) {
    path = path.slice(0, -1)
  }

  // Rule 1.5: legacy language index path. `/videos` used to be the public
  // language catalog entry; `/languages` is the canonical slug.
  if (path === "/videos") {
    path = "/languages"
  }

  // Rule 2: lowercase ".HTML" suffix (case-insensitive match → lowercase replace)
  path = path.replace(HTML_SUFFIX_REGEX_GI, HTML_SUFFIX_LOWER)

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
        stripHtmlSuffix(segs[1]),
        segs[2],
      ]
      path = `/${newSegs.join("/")}`
    }
  }

  // Rule 4: per-segment .html append (segment-count-aware).
  // 2-segment: append to both for video routes, except language-video
  // indexes (`/{lang}.html/videos`) keep the `videos` segment bare.
  // 3-segment: append to segments [0] and [2] only (episode segment stays
  // bare per production contract).
  {
    const segs = path.split("/").filter(Boolean)
    if (segs.length === 2) {
      const secondBare = stripHtmlSuffix(segs[1])
      const next = LOCALIZED_UTILITY_SEGMENTS.has(secondBare)
        ? [
            hasHtmlSuffix(segs[0]) ? segs[0] : `${segs[0]}${HTML_SUFFIX_LOWER}`,
            secondBare,
          ]
        : segs.map((s) => (hasHtmlSuffix(s) ? s : `${s}${HTML_SUFFIX_LOWER}`))
      path = `/${next.join("/")}`
    } else if (segs.length === 3) {
      const next = [
        hasHtmlSuffix(segs[0]) ? segs[0] : `${segs[0]}${HTML_SUFFIX_LOWER}`,
        segs[1],
        hasHtmlSuffix(segs[2]) ? segs[2] : `${segs[2]}${HTML_SUFFIX_LOWER}`,
      ]
      path = `/${next.join("/")}`
    }
  }

  // Rule 4.5: enforce 3-segment episode-bare contract. In the canonical
  // /{series}.html/{episode}/{lang}.html shape the middle segment must be
  // bare. Strip .html from segment 1 if present so the malformed shape
  // /series.html/ep.html/lang.html redirects to the canonical form.
  {
    const segs = path.split("/").filter(Boolean)
    if (segs.length === 3 && hasHtmlSuffix(segs[1])) {
      const next = [segs[0], stripHtmlSuffix(segs[1]), segs[2]]
      path = `/${next.join("/")}`
    }
  }

  // Rule 5: single-segment-no-.html → duplicate-with-.html.
  // /foo → /foo.html/foo.html. Skip whitelist entries (`languages`,
  // deprecated inbound `search`) which are legitimate 1-segment app routes.
  // SLUG_PATTERN_SAFE rejects host-shaped segments (e.g. /evil.com) that the
  // positive allowlist let through.
  {
    const segs = path.split("/").filter(Boolean)
    if (
      segs.length === 1 &&
      !hasHtmlSuffix(segs[0]) &&
      !ONE_SEGMENT_EXEMPT.has(segs[0]) &&
      SAFE_SLUG_PATTERN.test(segs[0])
    ) {
      path = `/${segs[0]}${HTML_SUFFIX_LOWER}/${segs[0]}${HTML_SUFFIX_LOWER}`
      temporaryRuleFired = true
    }
  }

  // Rule 6: language-slug alias resolution on the locale segment.
  // Localized utilities carry the locale at segment 0; video and episode
  // shapes keep it in the final segment.
  {
    const segs = path.split("/").filter(Boolean)
    const localeIdx =
      segs.length === 2 &&
      LOCALIZED_UTILITY_SEGMENTS.has(stripHtmlSuffix(segs[1]))
        ? 0
        : getWatchLocaleSegmentIndex(segs)
    if (localeIdx >= 0 && hasHtmlSuffix(segs[localeIdx])) {
      const bare = stripHtmlSuffix(segs[localeIdx])
      const canonical = tryResolveLanguageAlias(bare)
      if (canonical && canonical !== bare) {
        segs[localeIdx] = `${canonical}${HTML_SUFFIX_LOWER}`
        path = `/${segs.join("/")}`
      }
    }
  }

  if (path === raw) return { kind: "canonical" }

  // Defense-in-depth: re-check origin-invariance on the output. Any rule
  // composition that synthesized an unsafe Location MUST be rejected. Same
  // guard proxy.ts applies to its cookie-redirect output.
  if (isUnsafeRedirectPath(path)) return { kind: "canonical" }

  return {
    kind: "redirect",
    pathname: path,
    status: temporaryRuleFired ? 307 : 308,
    cache: temporaryRuleFired ? "short" : "long",
  }
}
