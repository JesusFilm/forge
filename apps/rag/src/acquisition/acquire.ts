/**
 * acquireOne — fetch one page through the injected Fetcher, extract its main
 * text, and assemble a RawDocument for the staging table. Acquisition stops
 * here: no normalize, chunk, embed, or corpus write (docs/architecture.md §3).
 *
 * Returns null (a logged skip, not a throw) when the page is unusable: a non-OK
 * / missing-body response, a not-modified response, or extracted text below the
 * source's minContentLength (a nav-only / boilerplate page). bodyHash is
 * sha256(response body) — the re-fetch identity, distinct from any contentHash.
 */
import { createHash } from "node:crypto"
import type {
  Fetcher,
  RawDocument,
  RawDocumentStore,
} from "../contracts/index.js"
import { type SourceEntry, seedUrls } from "../registry/index.js"
import { discoverUrls } from "./discover.js"
import { extractContent } from "./extract.js"
import { normalizeUrl } from "./normalize-url.js"

export type SkipReason = "fetch-failed" | "not-modified" | "too-thin"

export type AcquireOutcome =
  | { ok: true; doc: RawDocument }
  | { ok: false; reason: SkipReason; status: number | null }

export async function acquireOne(
  fetcher: Fetcher,
  entry: SourceEntry,
  url: string,
): Promise<AcquireOutcome> {
  const result = await fetcher.fetch(url, undefined, {
    expectedHost: new URL(entry.crawl.baseUrl).hostname,
    allowPatterns: entry.crawl.allow ?? [],
  })

  if (result.notModified) {
    return { ok: false, reason: "not-modified", status: result.status }
  }
  if (result.status == null || result.status >= 400 || result.body == null) {
    return { ok: false, reason: "fetch-failed", status: result.status }
  }

  const { title, text } = extractContent(result.body, entry.crawl)
  if (text.length < entry.crawl.minContentLength) {
    return { ok: false, reason: "too-thin", status: result.status }
  }

  const bodyHash = createHash("sha256").update(result.body).digest("hex")
  const doc: RawDocument = {
    sourceKey: entry.key,
    url,
    canonicalUrl: normalizeUrl(url),
    title,
    rawContent: text,
    fetch: {
      status: result.status,
      bodyHash,
      etag: result.etag,
      lastModified: result.lastModified,
      fetchedAt: new Date().toISOString(),
      notModified: false,
    },
  }
  return { ok: true, doc }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export interface AcquireSummary {
  sourceKey: string
  /** URLs to fetch after discovery/seed resolution + resume-skip + maxPages cap. */
  resolved: number
  attempted: number
  written: number
  skipped: Record<SkipReason, number>
}

export interface AcquireDeps {
  fetcher: Fetcher
  store: RawDocumentStore
}

export interface AcquireOptions {
  onProgress?: (line: string) => void
  /**
   * Resume mode: drop URLs already staged for this source (ingested or pending)
   * before fetching, so a paused-and-restarted — or English-already-acquired —
   * crawl re-fetches nothing it already has. A kill costs at most one in-flight
   * URL. Default off (a deliberate re-crawl/refresh still fetches everything).
   */
  resume?: boolean
  /** Resolve the URL list (discovery + filters + resume-skip), report the count, fetch nothing. */
  dryRun?: boolean
}

/**
 * Resolve the URL list to acquire for a source. A discovery source (one with
 * `sitemaps`) is walked via discoverUrls; its result is unioned with any
 * hand-listed seedPaths (so a discovery source can still pin extra pages). A
 * pure hand-listed source just uses its seeds. In `resume` mode, URLs already
 * staged for the source are dropped (compared on the normalized canonical URL —
 * the staging identity) BEFORE the maxPages cap, so the cap bounds the work that
 * actually remains. Capped at maxPages either way.
 */
async function resolveAcquireUrls(
  deps: AcquireDeps,
  entry: SourceEntry,
  opts: AcquireOptions,
): Promise<string[]> {
  const seeds = seedUrls(entry)
  let urls: string[]
  if (!entry.crawl.sitemaps?.length) {
    urls = seeds
  } else {
    opts.onProgress?.(
      `  ↪ discovering from ${entry.crawl.sitemaps.length} sitemap(s)…`,
    )
    // In resume mode, discover uncapped so the resume-skip runs against the full
    // candidate set and the final urls.slice(maxPages) is the single cap bounding
    // the work that REMAINS (discover.ts still guards fan-out via MAX_SITEMAP_FETCHES).
    const discoveryPolicy = opts.resume
      ? { ...entry.crawl, maxPages: Number.MAX_SAFE_INTEGER }
      : entry.crawl
    const disc = await discoverUrls(
      { fetcher: deps.fetcher },
      discoveryPolicy,
      opts,
    )
    opts.onProgress?.(
      `  ↪ discovered ${disc.urls.length} URL(s) (${disc.totalSeen} seen across ${disc.sitemapsFetched} sitemap(s))`,
    )
    urls = [...new Set([...seeds, ...disc.urls])]
  }
  if (opts.resume) {
    const staged = new Set(await deps.store.listStagedCanonicalUrls(entry.key))
    const before = urls.length
    urls = urls.filter((u) => !staged.has(normalizeUrl(u)))
    opts.onProgress?.(
      `  ↪ resume: ${before - urls.length} already-staged skipped, ${urls.length} to fetch`,
    )
  }
  return urls.slice(0, entry.crawl.maxPages)
}

/**
 * Acquire one source end-to-end: resolve its URL list (hand-listed seeds or
 * sitemap discovery, capped at maxPages) and walk it with a polite
 * requestDelayMs between fetches, acquireOne each, stage the ok docs via the
 * injected RawDocumentStore, and tally outcomes. Ports are injected — no adapter
 * is constructed here. `onProgress` lets the runner stream live lines.
 */
export async function acquireSource(
  deps: AcquireDeps,
  entry: SourceEntry,
  opts: AcquireOptions = {},
): Promise<AcquireSummary> {
  const urls = await resolveAcquireUrls(deps, entry, opts)
  const summary: AcquireSummary = {
    sourceKey: entry.key,
    resolved: urls.length,
    attempted: 0,
    written: 0,
    skipped: { "fetch-failed": 0, "not-modified": 0, "too-thin": 0 },
  }

  if (opts.dryRun) {
    opts.onProgress?.(
      `  ↪ DRY RUN — ${urls.length} URL(s) resolved; fetching nothing`,
    )
    return summary
  }

  for (let i = 0; i < urls.length; i++) {
    if (i > 0 && entry.crawl.requestDelayMs > 0)
      await sleep(entry.crawl.requestDelayMs)
    const url = urls[i]
    summary.attempted++
    let out: AcquireOutcome
    try {
      out = await acquireOne(deps.fetcher, entry, url)
    } catch (err) {
      // A network/timeout/DNS error rejects the fetch — count it as a skip and
      // keep crawling. One flaky page must never abandon the rest of the source.
      summary.skipped["fetch-failed"]++
      const msg = err instanceof Error ? err.message : String(err)
      opts.onProgress?.(`  ⤫ ${url}  — fetch-failed (error: ${msg})`)
      continue
    }
    if (out.ok) {
      await deps.store.putRawDocument(out.doc)
      summary.written++
      opts.onProgress?.(`  ✓ ${url}  (${out.doc.rawContent.length} chars)`)
    } else {
      summary.skipped[out.reason]++
      opts.onProgress?.(
        `  ⤫ ${url}  — ${out.reason} (status ${out.status ?? "—"})`,
      )
    }
  }
  return summary
}
