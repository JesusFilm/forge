/**
 * Persisted projection of a registry source (the `sources` table row shape).
 * The richer SourceDefinition/CrawlPolicy used for crawling lives in src/registry.
 * Types only. See docs/architecture.md §6.
 */

export type SourceTrust =
  | "owned"
  | "partner"
  | "trusted"
  | "evaluating"
  | "blocked"

export type IngestionMode = "html-scrape" | "api" | "manual" | "rss" | "blocked"

export interface SourceRecord {
  key: string // stable registry key, e.g. 'cru-org'
  name: string
  domain: string | null
  trust: SourceTrust
  ingestionMode: IngestionMode
  languages: string[]
  defaultTags: string[]
  defaultCategory: string | null
  rights: string | null
  contentHash: string | null // source-level reindex gate (skip when unchanged)
}

/** Structural source definition consumed by the pure indexing core. */
export interface SourceDefinition {
  key: string
  name: string
  domain: string
  trust: SourceTrust
  ingestionMode: IngestionMode
  languages: string[]
  defaultTags: string[]
  defaultCategory: string | null
  rights: string | null
  crawl: {
    baseUrl: string
    contentSelectors: readonly string[]
    stripSelectors: readonly string[]
    requestDelayMs: number
    maxPages: number
    minContentLength: number
  }
}
