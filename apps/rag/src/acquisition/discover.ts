/**
 * Discovery crawl (docs/architecture.md §3 fetch policy, FOLLOW-UP F) — turn a
 * source's sitemap(s) into the set of content-article URLs to acquire, without
 * hand-listing them. Fetches each sitemap through the injected Fetcher, parses
 * it with node-html-parser, recurses a <sitemapindex> into its child <sitemap>s,
 * then keeps the page URLs that pass the policy's `allow` ∧ `articleHints`
 * filters and clear `block`. Pure orchestration over the Fetcher port: no
 * normalize/chunk/embed, no adapter construction (§5). Output is just URLs —
 * acquireSource fetches + extracts them exactly as it does hand-listed seeds.
 */
import { parse } from "node-html-parser"
import type { Fetcher } from "../contracts/index.js"
import type { CrawlPolicy } from "../registry/index.js"

/** Guard against a pathological sitemap-index fan-out (cycles, thousands of children). */
const MAX_SITEMAP_FETCHES = 100

const compile = (patterns: string[] | undefined): RegExp[] =>
  (patterns ?? []).map((p) => new RegExp(p))

const matchesAny = (url: string, res: RegExp[]): boolean =>
  res.some((re) => re.test(url))

/**
 * A discovered URL is kept iff it is allowed (or no allow list is set), looks
 * like a content article (or no articleHints are set), and is not blocked.
 */
function keepUrl(
  url: string,
  allow: RegExp[],
  block: RegExp[],
  hints: RegExp[],
): boolean {
  if (allow.length > 0 && !matchesAny(url, allow)) return false
  if (hints.length > 0 && !matchesAny(url, hints)) return false
  if (block.length > 0 && matchesAny(url, block)) return false
  return true
}

export interface DiscoverDeps {
  fetcher: Fetcher
}

export interface DiscoverResult {
  /** Content URLs to acquire — filtered, de-duplicated, capped at maxPages. */
  urls: string[]
  /** Sitemap documents fetched (index + children). */
  sitemapsFetched: number
  /** Page URLs seen across all sitemaps, before allow/block/hints filtering. */
  totalSeen: number
}

/**
 * Walk a source's `sitemaps` (resolved against `baseUrl`) breadth-first: a
 * `<sitemapindex>`'s child `<sitemap><loc>`s are enqueued; a `<urlset>`'s
 * `<url><loc>`s are page candidates. Returns the kept page URLs (≤ maxPages).
 */
export async function discoverUrls(
  deps: DiscoverDeps,
  policy: CrawlPolicy,
  opts: { onProgress?: (line: string) => void } = {},
): Promise<DiscoverResult> {
  const allow = compile(policy.allow)
  const block = compile(policy.block)
  const hints = compile(policy.articleHints)

  const queue = (policy.sitemaps ?? []).map(
    (s) => new URL(s, policy.baseUrl).href,
  )
  const seenSitemaps = new Set<string>(queue)
  const pageUrls = new Set<string>()
  let sitemapsFetched = 0
  let totalSeen = 0

  while (queue.length > 0 && sitemapsFetched < MAX_SITEMAP_FETCHES) {
    const sm = queue.shift() as string
    const res = await deps.fetcher.fetch(sm)
    sitemapsFetched++
    if (res.status == null || res.status >= 400 || res.body == null) {
      opts.onProgress?.(`  ⤫ sitemap ${sm} — status ${res.status ?? "—"}`)
      continue
    }
    const root = parse(res.body)

    // <sitemapindex> → enqueue child sitemaps (deduped).
    for (const loc of root.querySelectorAll("sitemap loc")) {
      const child = loc.text.trim()
      if (child && !seenSitemaps.has(child)) {
        seenSitemaps.add(child)
        queue.push(child)
      }
    }
    // <urlset> → page candidates.
    for (const loc of root.querySelectorAll("url loc")) {
      const u = loc.text.trim()
      if (!u) continue
      totalSeen++
      if (keepUrl(u, allow, block, hints)) pageUrls.add(u)
    }
    opts.onProgress?.(
      `  ✓ sitemap ${sm} — ${pageUrls.size} kept / ${totalSeen} seen`,
    )
  }

  return {
    urls: [...pageUrls].slice(0, policy.maxPages),
    sitemapsFetched,
    totalSeen,
  }
}
