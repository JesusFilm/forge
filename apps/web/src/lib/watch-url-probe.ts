// Cutover-verification probe for the /watch URL space (Phase 6).
//
// The fixtures below are the §5 URL matrix from
// docs/research/jesusfilm-watch-url-patterns.md — the minimum set of public
// URL shapes that MUST keep resolving after the .html-shape migration. The
// CLI (apps/web/scripts/probe-watch-urls.ts) hits each path against BOTH a
// production baseline and a rewrite preview, then `classifyProbe` diffs the
// two into regression buckets. The gate: 0 hard regressions, ≤2% soft.
//
// This module is pure + network-isolated except `probeUrl` (the one fetch
// boundary), so `classifyProbe` + the fixtures are unit-tested directly.

/** Nominal expected outcome per §5 section — used for self-test + reporting, NOT the prod-vs-preview gate. */
export type ProbeExpect = "ok" | "redirect" | "notfound" | "passthrough"

export type WatchUrlFixture = {
  /** Full path including the `/watch` basePath (e.g. `/watch/jesus.html/english.html`). */
  path: string
  /** §5 section label for grouped reporting. */
  group: string
  expect: ProbeExpect
}

const ROOTS: readonly string[] = [
  "/watch",
  // NOTE: `/watch/` (trailing slash) lives in REDIRECTS — it 308s to `/watch`
  // per §5.4, so it is probed as a redirect, not a root 200.
  "/watch/languages",
  "/watch/english.html",
  "/watch/russian.html",
  "/watch/portuguese-brazil.html",
  "/watch/portuguese-portugal.html",
  "/watch/spanish-castilian.html",
  "/watch/spanish-latin-american.html",
  "/watch/mandarin-china.html",
  "/watch/arabic-modern-standard.html",
  "/watch/french.html",
  "/watch/german.html",
  "/watch/japanese.html",
  "/watch/korean.html",
  "/watch/hindi.html",
  "/watch/tamil.html",
  "/watch/turkish.html",
  "/watch/swahili.html",
]

const TWO_SEGMENT: readonly string[] = [
  "/watch/jesus.html/english.html",
  "/watch/jesus.html/spanish-castilian.html",
  "/watch/jesus.html/spanish-latin-american.html",
  "/watch/jesus.html/portuguese-brazil.html",
  "/watch/jesus.html/portuguese-portugal.html",
  "/watch/jesus.html/arabic-modern-standard.html",
  "/watch/jesus.html/french.html",
  "/watch/jesus.html/mandarin-china.html",
  "/watch/jesus.html/cantonese.html",
  "/watch/jesus.html/japanese.html",
  "/watch/jesus.html/korean.html",
  "/watch/jesus.html/hindi.html",
  "/watch/jesus.html/tamil.html",
  "/watch/jesus.html/zulu.html",
  "/watch/jesus.html/swahili.html",
  "/watch/magdalena-2.html/english.html",
  "/watch/magdalena.html/russian.html",
  "/watch/chosen-witness.html/english.html",
  "/watch/fallingplates.html/english.html",
  "/watch/the-savior.html/russian.html",
  "/watch/birth-of-jesus.html/english.html",
  "/watch/wedding-in-cana.html/english.html",
  "/watch/jesus-calms-the-storm.html/english.html",
  "/watch/paul-and-silas-in-prison.html/english.html",
  "/watch/peter-miraculous-escape-from-prison.html/english.html",
  "/watch/the-woman-with-the-issue-of-blood.html/english.html",
  "/watch/day-6-jesus-died-for-me.html/english.html",
  "/watch/8-days-with-jesus-who-is-jesus.html/english.html",
  "/watch/storyclubs-jesus-and-zacchaeus.html/english.html",
  // Series landings
  "/watch/lumo-the-gospel-of-john.html/english.html",
  "/watch/lumo-the-gospel-of-luke.html/english.html",
  "/watch/lumo-the-gospel-of-mark.html/english.html",
  "/watch/lumo-the-gospel-of-matthew.html/english.html",
  "/watch/lumo-the-gospel-of-john.html/russian.html",
  "/watch/lumo-the-gospel-of-luke.html/russian.html",
  "/watch/lumo-the-gospel-of-mark.html/russian.html",
  "/watch/lumo-the-gospel-of-matthew.html/russian.html",
  "/watch/life-of-jesus-gospel-of-john.html/english.html",
  "/watch/life-of-jesus-gospel-of-john.html/russian.html",
  "/watch/book-of-acts.html/english.html",
  "/watch/book-of-acts.html/russian.html",
  "/watch/reflections-of-hope.html/english.html",
  "/watch/new-believer-course.html/english.html",
  "/watch/pilgrims-progress.html/russian.html",
  // Curated collections / Experiences
  "/watch/women-resources.html/english.html",
  "/watch/women-resources.html/russian.html",
  "/watch/discipleship.html/english.html",
  "/watch/discipleship.html/russian.html",
  "/watch/conversation-starters.html/english.html",
  "/watch/conversation-starters.html/russian.html",
  "/watch/easter.html/english.html",
  "/watch/easter.html/russian.html",
  "/watch/evangelism.html/russian.html",
  "/watch/family.html/russian.html",
  "/watch/relationships.html/russian.html",
  "/watch/love-your-neighbor.html/russian.html",
  "/watch/student-resources.html/russian.html",
  "/watch/storyclubs.html/russian.html",
  "/watch/jfm-collection.html/russian.html",
  "/watch/world-youth-day.html/russian.html",
  "/watch/anticipate-the-resurrection.html/russian.html",
]

const EPISODES: readonly string[] = [
  "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
  "/watch/lumo-the-gospel-of-luke.html/birth-of-jesus/english.html",
  "/watch/lumo-the-gospel-of-luke.html/birth-of-jesus/spanish-castilian.html",
  "/watch/lumo-the-gospel-of-mark.html/jesus-baptism/english.html",
  "/watch/jesus.html/the-beginning/english.html",
  "/watch/jesus.html/the-beginning/spanish-castilian.html",
  "/watch/jesus.html/the-beginning/russian.html",
]

// §5.3 legacy 4-segment + §5.4 normalization — must REDIRECT (3xx), not 404.
const REDIRECTS: readonly string[] = [
  "/watch/search",
  "/watch/videos",
  "/watch/lumo-the-gospel-of-john/wedding-in-cana.html/english.html",
  "/watch/jesus/the-beginning.html/english.html",
  "/watch/",
  "/watch/jesus.html/",
  "/watch/jesus.html/english.html/",
  "/watch/jesus.HTML/english.html",
  "/watch/jesus.html/english",
  "/watch/jesus.html/chinese-mandarin.html",
]

// §5.5 — query params / fragment must still 200 (same final content URL).
const QUERY_PARAMS: readonly string[] = [
  "/watch/jesus.html/english.html?t=120",
  "/watch/jesus.html/english.html?autoplay=1",
  "/watch/jesus.html/english.html?utm_source=campaign&utm_medium=email",
]

// §5.6 — must STAY 404 (must NOT become 200 or 301).
const EXPECTED_404S: readonly string[] = [
  "/watch/search.html/search.html",
  "/watch/jesus.html",
  "/watch/JESUS.html/english.html",
  "/watch/jesus.html/fran%C3%A7ais.html",
  "/watch/.html",
  "/watch/jesus.html/en.html",
  "/watch/jesus.html/pt-br.html",
  "/watch/easter.html/non-existent.html",
]

// §5.7 — asset / framework subtrees must resolve normally (NO wildcard catch).
const PASSTHROUGH: readonly string[] = [
  "/watch/assets/overlay.svg",
  "/watch/images/jesusfilm-sign.svg",
  "/watch/images/favicon-32.png",
  "/watch/images/flags/ru.svg",
  "/watch/images/overlay.svg",
  "/watch/fonts/Montserrat-VariableFont_wght.woff2",
  "/watch/api/preview",
  "/watch/api/revalidate",
]

function fixturesOf(
  paths: readonly string[],
  group: string,
  expect: ProbeExpect,
): WatchUrlFixture[] {
  return paths.map((path) => ({ path, group, expect }))
}

/** The full §5 probe matrix. */
export const WATCH_URL_FIXTURES: readonly WatchUrlFixture[] = [
  ...fixturesOf(ROOTS, "5.1 roots", "ok"),
  ...fixturesOf(TWO_SEGMENT, "5.2 two-segment", "ok"),
  ...fixturesOf(EPISODES, "5.3 episodes", "ok"),
  ...fixturesOf(REDIRECTS, "5.4 normalization redirects", "redirect"),
  ...fixturesOf(QUERY_PARAMS, "5.5 query params", "ok"),
  ...fixturesOf(EXPECTED_404S, "5.6 expected 404s", "notfound"),
  ...fixturesOf(PASSTHROUGH, "5.7 asset/framework subtrees", "passthrough"),
]

/** One side's probe result for a single URL. */
export type ProbeResult = {
  /** Final HTTP status after following up to MAX_REDIRECT_HOPS redirects. */
  status: number
  /** Final pathname (origin-stripped) after redirects — the comparable key across hosts. */
  finalPath: string
  redirectHops: number
  ms: number
  /** Set when the request failed at the transport layer (DNS, timeout, etc.). */
  error?: string
}

export type ProbeOutcome =
  | "match" // same status class + same final path
  | "acceptable" // prod redirected, preview served 200 directly (skipped redundant hop)
  | "soft-regression" // same status class, different final path (SEO/canonical drift)
  | "hard-regression" // broken contract: 2xx→4xx, expected-404 now resolves, redirect→error
  | "error" // transport error on one side; cannot compare

export type ProbeComparison = {
  path: string
  group: string
  production: ProbeResult
  preview: ProbeResult
  outcome: ProbeOutcome
  note: string
}

const statusClass = (status: number): number => Math.floor(status / 100)

type ClassifyFixture = {
  path: string
  expect: ProbeExpect
}

function passthroughViolation(
  side: "preview",
  result: ProbeResult,
  expectedPath: string,
): string | null {
  if (statusClass(result.status) === 3) {
    return `${side} returned redirect status ${result.status}`
  }
  if (result.redirectHops > 0) {
    return `${side} redirected ${result.redirectHops} hop(s) before ${result.finalPath}`
  }
  if (result.finalPath !== expectedPath) {
    return `${side} final path changed: expected ${expectedPath}, got ${result.finalPath}`
  }
  return null
}

function isDeprecatedSearchFallback(
  preview: ProbeResult,
  fixture: ClassifyFixture,
): boolean {
  return (
    fixture.path === "/watch/search" &&
    fixture.expect === "redirect" &&
    statusClass(preview.status) === 2 &&
    preview.finalPath === "/watch"
  )
}

/**
 * Diff a production baseline against a rewrite-preview result for ONE URL.
 * Pure — the heart of the cutover gate. Compares status CLASS + final path.
 *
 * Buckets:
 * - `error`            — either side failed at transport; cannot baseline.
 * - `hard-regression`  — prod 2xx → preview 4xx/5xx (broken link), prod 3xx →
 *                        preview 4xx/5xx (redirect now errors), OR an expected
 *                        404 that now resolves/redirects (prod 4xx → preview
 *                        non-4xx — §5.6 contract violation).
 * - `acceptable`       — prod 3xx → preview 2xx (preview skips a redundant
 *                        redirect and serves directly).
 * - `soft-regression`  — same status class but a DIFFERENT final path (canonical
 *                        / SEO drift; needs stakeholder review), or prod 2xx →
 *                        preview 3xx.
 * - `match`            — same status class + same final path.
 */
export function classifyProbe(
  production: ProbeResult,
  preview: ProbeResult,
  fixture?: ClassifyFixture,
): { outcome: ProbeOutcome; note: string } {
  if (production.error || preview.error) {
    return {
      outcome: "error",
      note: production.error
        ? `production transport error: ${production.error}`
        : `preview transport error: ${preview.error}`,
    }
  }

  if (fixture?.expect === "passthrough") {
    const previewViolation = passthroughViolation(
      "preview",
      preview,
      fixture.path,
    )
    if (previewViolation) {
      return {
        outcome: "hard-regression",
        note: `PASSTHROUGH CONTRACT BROKEN: ${previewViolation}`,
      }
    }
    return {
      outcome: "match",
      note: "passthrough preview preserved requested path",
    }
  }

  if (fixture && isDeprecatedSearchFallback(preview, fixture)) {
    return {
      outcome: "acceptable",
      note: "deprecated search routed to the root search-modal surface",
    }
  }

  const pc = statusClass(production.status)
  const vc = statusClass(preview.status)
  const samePath = production.finalPath === preview.finalPath

  if (vc === 3 && preview.redirectHops >= MAX_REDIRECT_HOPS) {
    return {
      outcome: "hard-regression",
      note: `REDIRECT LOOP: preview returned ${preview.status} after ${preview.redirectHops} hop(s) ending at ${preview.finalPath}`,
    }
  }

  if (pc === 5) {
    return {
      outcome: "error",
      note: `production returned ${production.status}; cannot baseline`,
    }
  }

  if (pc === 2) {
    if (vc === 2) {
      return samePath
        ? { outcome: "match", note: "200 → 200, same final path" }
        : {
            outcome: "soft-regression",
            note: `200 on both but final path differs: prod ${production.finalPath} vs preview ${preview.finalPath}`,
          }
    }
    if (vc === 3) {
      return {
        outcome: "soft-regression",
        note: `prod 200 but preview ${preview.status} → ${preview.finalPath}`,
      }
    }
    return {
      outcome: "hard-regression",
      note: `BROKEN LINK: prod ${production.status} → preview ${preview.status}`,
    }
  }

  if (pc === 3) {
    if (vc === 2) {
      return {
        outcome: "acceptable",
        note: `prod ${production.status} → preview served 200 directly (skipped redundant redirect)`,
      }
    }
    if (vc === 3) {
      return samePath
        ? { outcome: "match", note: "redirect → same final path" }
        : {
            outcome: "soft-regression",
            note: `redirect target differs: prod ${production.finalPath} vs preview ${preview.finalPath}`,
          }
    }
    return {
      outcome: "hard-regression",
      note: `redirect became error: prod ${production.status} → preview ${preview.status}`,
    }
  }

  // pc === 4 — production 404 (or other 4xx). §5.6: must STAY 404.
  if (vc === 4) {
    return { outcome: "match", note: `404 preserved (${preview.status})` }
  }
  return {
    outcome: "hard-regression",
    note: `EXPECTED-404 CONTRACT BROKEN: prod ${production.status} → preview ${preview.status} (must not resolve or redirect)`,
  }
}

/** Outcomes that fail the cutover gate outright (any count > 0 fails). */
export const HARD_FAIL_OUTCOMES: ReadonlySet<ProbeOutcome> = new Set([
  "hard-regression",
])

export const MAX_REDIRECT_HOPS = 5
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Fetch `${origin}${path}`, manually following up to MAX_REDIRECT_HOPS
 * redirects so we can capture the full chain length + the final
 * origin-stripped pathname (the cross-host comparable key). The single
 * network boundary in this module; everything else is pure.
 */
export async function probeUrl(
  origin: string,
  path: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const start = Date.now()
  let currentUrl = `${origin}${path}`
  let hops = 0

  try {
    for (;;) {
      const res = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      })

      const sc = statusClass(res.status)
      const location = res.headers.get("location")

      if (sc === 3 && location && hops < MAX_REDIRECT_HOPS) {
        hops += 1
        // Location may be relative or absolute; resolve against the current URL.
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }

      return {
        status: res.status,
        finalPath: new URL(currentUrl).pathname,
        redirectHops: hops,
        ms: Date.now() - start,
      }
    }
  } catch (err) {
    return {
      status: 0,
      finalPath: new URL(currentUrl).pathname,
      redirectHops: hops,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
