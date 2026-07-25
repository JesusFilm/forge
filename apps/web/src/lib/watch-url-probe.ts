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
  /** Full path including the `/watch` basePath (e.g. `/watch/jesus.html`). */
  path: string
  /** §5 section label for grouped reporting. */
  group: string
  expect: ProbeExpect
  /** Preview must answer this public path directly without any redirect hop. */
  requireDirect?: boolean
  /** Canonical, Open Graph, and page-level JSON-LD identity for key routes. */
  expectedCanonicalPath?: string
  /** The route must publish a page-level JSON-LD URL matching the canonical. */
  requireStructuredDataCanonical?: boolean
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

const EXPLICIT_LANGUAGE: readonly string[] = [
  // Explicit English remains a direct compatibility URL.
  "/watch/jesus.html/english.html",
  "/watch/jesus.html/romanian.html",
  "/watch/jesus.html/russian.html",
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
  "/watch/jesus.html?t=120",
  "/watch/jesus.html?autoplay=1",
  "/watch/jesus.html?utm_source=campaign&utm_medium=email",
]

const LANGUAGELESS_ENGLISH: readonly string[] = [
  "/watch/jesus.html",
  "/watch/magdalena-2.html",
  "/watch/chosen-witness.html",
  "/watch/wedding-in-cana.html",
  "/watch/life-of-jesus-gospel-of-john.html",
  "/watch/easter.html",
]

// §5.6 — must STAY 404 (must NOT become 200 or 301).
const EXPECTED_404S: readonly string[] = [
  "/watch/search.html/search.html",
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
  return paths.map((path) => ({
    path,
    group,
    expect,
    ...(WATCH_DIRECT_PATH_CONTRACTS.has(path) ? { requireDirect: true } : {}),
    ...(WATCH_CANONICAL_PATH_CONTRACTS[path]
      ? {
          expectedCanonicalPath: WATCH_CANONICAL_PATH_CONTRACTS[path],
          requireStructuredDataCanonical: true,
        }
      : {}),
  }))
}

const WATCH_CANONICAL_PATH_CONTRACTS: Readonly<Record<string, string>> = {
  "/watch/jesus.html": "/watch/jesus.html",
  "/watch/jesus.html/english.html": "/watch/jesus.html",
  "/watch/jesus.html/romanian.html": "/watch/jesus.html/romanian.html",
  "/watch/jesus.html/russian.html": "/watch/jesus.html/russian.html",
  "/watch/jesus.html/spanish-castilian.html":
    "/watch/jesus.html/spanish-castilian.html",
  "/watch/jesus.html/spanish-latin-american.html":
    "/watch/jesus.html/spanish-latin-american.html",
  "/watch/lumo-the-gospel-of-john.html/english.html":
    "/watch/lumo-the-gospel-of-john.html",
  "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html":
    "/watch/lumo-john-1-35-2-22.html",
  "/watch/jesus.html/the-beginning/spanish-castilian.html":
    "/watch/the-beginning.html/spanish-castilian.html",
}

// Keep hard direct-route assertions focused on the canonical contracts this
// change owns. The wider legacy matrix intentionally contains language homes
// that normalize to `/videos`, catalog-dependent aliases, and historical
// samples that can be unavailable on both sides; those remain protected by
// production-vs-preview status and final-path comparison.
const WATCH_DIRECT_PATH_CONTRACTS: ReadonlySet<string> = new Set([
  ...LANGUAGELESS_ENGLISH,
  ...QUERY_PARAMS,
  ...Object.keys(WATCH_CANONICAL_PATH_CONTRACTS),
])

/** The full §5 probe matrix. */
export const WATCH_URL_FIXTURES: readonly WatchUrlFixture[] = [
  ...fixturesOf(ROOTS, "5.1 roots", "ok"),
  ...fixturesOf(LANGUAGELESS_ENGLISH, "5.2 standalone videos", "ok"),
  ...fixturesOf(EXPLICIT_LANGUAGE, "5.2 standalone videos", "ok"),
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
  structuredData?: {
    scriptCount: number
    types: string[]
    parseErrors: string[]
    pageUrls: string[]
  }
  documentIdentity?: {
    canonicalUrl: string | null
    openGraphUrl: string | null
  }
  /** Set when the request failed at the transport layer (DNS, timeout, etc.). */
  error?: string
}

export type StructuredDataContract = {
  /** Exact number of each page-level entity required in the literal response HTML. */
  required: Readonly<Record<string, number>>
  /** Entity types that this route class must never publish. */
  forbidden: readonly string[]
}

/**
 * Representative public routes whose schema is part of the cutover contract.
 *
 * This is deliberately a small matrix, rather than a requirement for every URL
 * fixture: empty, noindex, and legacy redirect routes intentionally do not all
 * publish the same JSON-LD. The selected routes cover root/localized homes,
 * series, a standalone video, and a contextual episode.
 */
export const WATCH_STRUCTURED_DATA_CONTRACTS: Readonly<
  Record<string, StructuredDataContract>
> = {
  "/watch": {
    required: { CollectionPage: 1 },
    forbidden: ["VideoObject", "BreadcrumbList", "Clip", "FAQPage"],
  },
  "/watch/spanish-castilian.html": {
    required: { CollectionPage: 1 },
    forbidden: ["VideoObject", "BreadcrumbList", "Clip", "FAQPage"],
  },
  "/watch/lumo-the-gospel-of-john.html/english.html": {
    required: { CollectionPage: 1 },
    forbidden: ["VideoObject", "BreadcrumbList", "Clip", "FAQPage"],
  },
  "/watch/jesus.html": {
    required: { VideoObject: 1 },
    forbidden: ["CollectionPage", "BreadcrumbList", "Clip", "FAQPage"],
  },
  "/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html": {
    required: { VideoObject: 1 },
    forbidden: ["CollectionPage", "BreadcrumbList", "Clip", "FAQPage"],
  },
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
  requireDirect?: boolean
  expectedCanonicalPath?: string
  requireStructuredDataCanonical?: boolean
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

function pathnameFromUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value, "https://www.jesusfilm.org").pathname
  } catch {
    return null
  }
}

function canonicalIdentityViolations(
  result: ProbeResult,
  fixture: ClassifyFixture,
): string[] {
  const expected = fixture.expectedCanonicalPath
  if (!expected) return []

  const canonicalPath = pathnameFromUrl(result.documentIdentity?.canonicalUrl)
  const openGraphPath = pathnameFromUrl(result.documentIdentity?.openGraphUrl)
  const violations: string[] = []
  if (canonicalPath !== expected) {
    violations.push(
      `canonical expected ${expected}, got ${canonicalPath ?? "missing"}`,
    )
  }
  if (openGraphPath !== expected) {
    violations.push(
      `og:url expected ${expected}, got ${openGraphPath ?? "missing"}`,
    )
  }

  const pageUrlPaths = (result.structuredData?.pageUrls ?? []).map(
    pathnameFromUrl,
  )
  if (fixture.requireStructuredDataCanonical && pageUrlPaths.length === 0) {
    violations.push("page-level JSON-LD canonical URL missing")
  }
  for (const pageUrlPath of pageUrlPaths) {
    if (pageUrlPath !== expected) {
      violations.push(
        `page-level JSON-LD URL expected ${expected}, got ${pageUrlPath ?? "invalid"}`,
      )
    }
  }
  return violations
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

  if (
    statusClass(preview.status) === 3 &&
    preview.redirectHops >= MAX_REDIRECT_HOPS
  ) {
    return {
      outcome: "hard-regression",
      note: `REDIRECT LOOP: preview returned ${preview.status} after ${preview.redirectHops} hop(s) ending at ${preview.finalPath}`,
    }
  }

  const malformedJsonLd = preview.structuredData?.parseErrors ?? []
  if (malformedJsonLd.length > 0) {
    return {
      outcome: "hard-regression",
      note: `MALFORMED JSON-LD: ${malformedJsonLd.join("; ")}`,
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

  if (pc === 5) {
    return {
      outcome: "error",
      note: `production returned ${production.status}; cannot baseline`,
    }
  }

  if (fixture?.requireDirect) {
    const requestedPath = pathnameFromUrl(fixture.path)
    if (
      vc !== 2 ||
      preview.redirectHops !== 0 ||
      preview.finalPath !== requestedPath
    ) {
      return {
        outcome: "hard-regression",
        note:
          "DIRECT ROUTE CONTRACT: " +
          `expected direct 2xx at ${requestedPath}, got ${preview.status} after ` +
          `${preview.redirectHops} hop(s) at ${preview.finalPath}`,
      }
    }
  }

  if (fixture?.expectedCanonicalPath) {
    const violations = canonicalIdentityViolations(preview, fixture)
    if (violations.length > 0) {
      return {
        outcome: "hard-regression",
        note: `CANONICAL IDENTITY CONTRACT: ${violations.join("; ")}`,
      }
    }
  }

  const structuredDataContract = fixture
    ? WATCH_STRUCTURED_DATA_CONTRACTS[fixture.path]
    : undefined
  if (structuredDataContract) {
    const violations = validateStructuredDataContract(
      preview.structuredData,
      structuredDataContract,
    )
    if (violations.length > 0) {
      return {
        outcome: "hard-regression",
        note: `JSON-LD CONTRACT: ${violations.join("; ")}`,
      }
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

export function parseJsonLdScripts(html: string): {
  scriptCount: number
  types: string[]
  parseErrors: string[]
  pageUrls: string[]
} {
  const scripts = Array.from(
    html.matchAll(
      /<script\b[^>]*\btype=(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  )
  const types: string[] = []
  const parseErrors: string[] = []
  const pageUrls: string[] = []

  for (const [index, match] of scripts.entries()) {
    try {
      const parsed = JSON.parse(match[1] ?? "") as unknown
      types.push(...collectJsonLdTypes(parsed))
      pageUrls.push(...collectJsonLdPageUrls(parsed))
    } catch (error) {
      parseErrors.push(
        `script ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    scriptCount: scripts.length,
    types,
    parseErrors,
    pageUrls,
  }
}

function ownJsonLdTypes(record: Record<string, unknown>): string[] {
  const type = record["@type"]
  return typeof type === "string"
    ? [type]
    : Array.isArray(type)
      ? type.filter((entry): entry is string => typeof entry === "string")
      : []
}

function collectJsonLdTypes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectJsonLdTypes)
  }
  if (typeof value !== "object" || value == null) return []

  const record = value as Record<string, unknown>
  return [
    ...ownJsonLdTypes(record),
    ...Object.values(record).flatMap((entry) => collectJsonLdTypes(entry)),
  ]
}

function collectJsonLdPageUrls(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectJsonLdPageUrls)
  if (typeof value !== "object" || value == null) return []

  const record = value as Record<string, unknown>
  const ownTypes = ownJsonLdTypes(record)
  const ownUrl =
    ownTypes.some(
      (type) => type === "VideoObject" || type === "CollectionPage",
    ) && typeof record.url === "string"
      ? [record.url]
      : []
  return [
    ...ownUrl,
    ...Object.values(record).flatMap((entry) => collectJsonLdPageUrls(entry)),
  ]
}

function htmlAttribute(tag: string, name: string): string | null {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  )
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  if (value == null) return null
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

export function parseDocumentIdentity(html: string): {
  canonicalUrl: string | null
  openGraphUrl: string | null
} {
  const linkTags = Array.from(html.matchAll(/<link\b[^>]*>/gi), ([tag]) => tag)
  const canonicalTag = linkTags.find((tag) =>
    (htmlAttribute(tag, "rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .includes("canonical"),
  )
  const metaTags = Array.from(html.matchAll(/<meta\b[^>]*>/gi), ([tag]) => tag)
  const openGraphTag = metaTags.find(
    (tag) =>
      (
        htmlAttribute(tag, "property") ?? htmlAttribute(tag, "name")
      )?.toLowerCase() === "og:url",
  )

  return {
    canonicalUrl: canonicalTag ? htmlAttribute(canonicalTag, "href") : null,
    openGraphUrl: openGraphTag ? htmlAttribute(openGraphTag, "content") : null,
  }
}

/**
 * Returns the schema contract violations in a complete initial response.
 * Missing HTML/JSON-LD is intentionally treated as zero entities, so a route
 * that drops a required script cannot quietly pass the CLI gate.
 */
export function validateStructuredDataContract(
  structuredData: ProbeResult["structuredData"],
  contract: StructuredDataContract,
): string[] {
  const typeCounts = new Map<string, number>()
  for (const type of structuredData?.types ?? []) {
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
  }

  const violations: string[] = []
  for (const [type, expectedCount] of Object.entries(contract.required)) {
    const actualCount = typeCounts.get(type) ?? 0
    if (actualCount !== expectedCount) {
      violations.push(
        `expected exactly ${expectedCount} ${type}, found ${actualCount}`,
      )
    }
  }
  for (const type of contract.forbidden) {
    const actualCount = typeCounts.get(type) ?? 0
    if (actualCount > 0) {
      violations.push(`forbidden ${type} found ${actualCount} time(s)`)
    }
  }

  return violations
}

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

      const contentType = res.headers.get("content-type") ?? ""
      const html = contentType.includes("text/html") ? await res.text() : null
      const structuredData = html ? parseJsonLdScripts(html) : undefined
      const documentIdentity = html ? parseDocumentIdentity(html) : undefined

      return {
        status: res.status,
        finalPath: new URL(currentUrl).pathname,
        redirectHops: hops,
        ms: Date.now() - start,
        ...(structuredData && { structuredData }),
        ...(documentIdentity && { documentIdentity }),
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
