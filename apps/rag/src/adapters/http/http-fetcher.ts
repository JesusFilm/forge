import type {
  ConditionalHeaders,
  Fetcher,
  FetchResult,
} from "../../contracts/index.js"

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

export type HttpFetcherOptions = { userAgent?: string; timeoutMs?: number }

export class HttpFetcher implements Fetcher {
  constructor(private readonly options: HttpFetcherOptions = {}) {}

  async fetch(
    url: string,
    conditional?: ConditionalHeaders,
  ): Promise<FetchResult> {
    const headers: Record<string, string> = {
      "user-agent": this.options.userAgent ?? DEFAULT_USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    if (conditional?.ifNoneMatch)
      headers["if-none-match"] = conditional.ifNoneMatch
    if (conditional?.ifModifiedSince)
      headers["if-modified-since"] = conditional.ifModifiedSince

    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 20_000,
    )
    try {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      })
      const metadata = {
        status: response.status,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      }
      if (response.status === 304)
        return { ...metadata, body: null, notModified: true }
      return { ...metadata, body: await response.text(), notModified: false }
    } finally {
      clearTimeout(timer)
    }
  }
}
