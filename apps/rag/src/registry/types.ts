/**
 * SourceRegistry data types — the richer, crawl-time shape of a source (the
 * persisted projection is `SourceRecord` in contracts/sources.ts). Pure data:
 * no I/O, no behavior. The registry may import only `contracts`. See
 * docs/architecture.md §3 (Acquisition) and §4–§5.
 */
import type { IngestionMode, SourceTrust } from "../contracts/index.js"

/**
 * How a source's bytes are obtained during acquisition — plain HTTP, or a
 * rendered browser via Firecrawl (for walled sources whose content pages sit
 * behind a JS bot wall plain HTTP cannot pass). A deliberate, per-source choice
 * declared at slice time; never selected or switched at runtime. See ADR-0012.
 */
export type FetchStrategy = "plain-http" | "firecrawl"

/**
 * How a source is crawled. Two modes, both valid:
 *
 *  - **Hand-listed** (slices #1–2): set `seedPaths` to the exact content pages.
 *    Small, static, curated scopes (Starting With God).
 *  - **Discovery** (slice #3+, FOLLOW-UP F): set `sitemaps` + the `allow`/`block`/
 *    `articleHints` filters and let Acquisition discover the article set from the
 *    site's sitemap. The only tractable way to reach a large source (jesusfilm.org
 *    ~1,200 pages, Sightline ~2,500). §3 already declares Acquisition owns this
 *    `allow`/`block` fetch policy; discovery finishes it.
 *
 * A policy may set both (discovered URLs ∪ seedPaths). All regex filters are
 * matched against the full absolute URL.
 */
export interface CrawlPolicy {
  /** Origin used to resolve relative `seedPaths` / `sitemaps` into absolute URLs. */
  baseUrl: string
  /**
   * Fetch strategy for EVERY request this source makes — sitemap discovery and
   * content pages alike. Absent means `plain-http`, so plain HTTP stays the
   * zero-config norm and Firecrawl is strictly opt-in. Registry-only: never
   * persisted to the source row (acquisition is the sole consumer).
   */
  fetchStrategy?: FetchStrategy
  /** Hand-listed content-page paths (relative to `baseUrl`) to acquire. Omit for a pure discovery crawl. */
  seedPaths?: string[]
  /**
   * Sitemap URLs (or paths against `baseUrl`) to discover content URLs from.
   * A `<sitemapindex>` is auto-recursed into its child `<sitemap>` entries.
   * Presence of this field makes the source a discovery crawl.
   */
  sitemaps?: string[]
  /** Discovery keep-filter: a discovered URL is kept only if it matches ≥1 of these regexes (skip if empty/absent). */
  allow?: string[]
  /** Discovery drop-filter: a discovered URL is dropped if it matches any of these regexes (login/donate/cart/feed/asset…). */
  block?: string[]
  /** Discovery article-filter: keep only URLs matching ≥1 of these (a content article, not an index/nav/listing). */
  articleHints?: string[]
  /** CSS selectors for the main content container, tried in order — first match wins. */
  contentSelectors: string[]
  /** Selectors removed from the content container before text extraction (nav, sidebar, footer, share widgets, comments). */
  stripSelectors: string[]
  /** Polite delay between fetches, in milliseconds. */
  requestDelayMs: number
  /** Safety cap on pages fetched per run. */
  maxPages: number
  /** Drop a page whose extracted text is shorter than this many characters. */
  minContentLength: number
}

/** A registered source plus its crawl policy. */
export interface SourceEntry {
  key: string // stable registry key, e.g. 'starting-with-god'
  name: string
  domain: string // bare host, e.g. 'www.startingwithgod.com'
  trust: SourceTrust
  ingestionMode: IngestionMode
  languages: string[]
  defaultTags: string[]
  defaultCategory: string | null
  rights: string | null
  /** Operational acquisition state. Omit when the source is ready to acquire. */
  acquisition?: {
    enabled: false
    reason: string
  }
  crawl: CrawlPolicy
}
