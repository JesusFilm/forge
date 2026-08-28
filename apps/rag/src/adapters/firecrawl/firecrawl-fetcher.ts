import type {
  ConditionalHeaders,
  Fetcher,
  FetchResult,
} from "../../contracts/index.js"

type ScrapeResponse = {
  success?: boolean
  error?: string
  data?: { rawHtml?: string; metadata?: { statusCode?: number } }
}

export type FirecrawlFetcherOptions = { apiKey: string; timeoutMs?: number }

export class FirecrawlFetcher implements Fetcher {
  constructor(private readonly options: FirecrawlFetcherOptions) {
    if (!options.apiKey) throw new Error("FirecrawlFetcher: apiKey is required")
  }

  async fetch(
    url: string,
    _conditional?: ConditionalHeaders,
  ): Promise<FetchResult> {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 60_000,
    )
    try {
      const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["rawHtml"],
          maxAge: 0,
          storeInCache: false,
        }),
        signal: controller.signal,
      })
      if (!response.ok)
        throw new Error(
          `firecrawl: API responded ${response.status} scraping ${url}`,
        )
      const payload = (await response.json()) as ScrapeResponse
      if (!payload.success || payload.data?.rawHtml === undefined)
        throw new Error(
          `firecrawl: scrape failed for ${url}: ${payload.error ?? "no rawHtml in response"}`,
        )
      return {
        status: payload.data.metadata?.statusCode ?? null,
        body: payload.data.rawHtml,
        etag: null,
        lastModified: null,
        notModified: false,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
