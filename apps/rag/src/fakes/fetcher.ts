/**
 * In-memory Fetcher fake for Acquisition unit tests. Seed canned responses per
 * URL; unknown URLs return a 404. Honors conditional requests: a matching
 * If-None-Match yields a 304 not-modified result, exercising the http-cache path
 * without a network.
 */
import type {
  ConditionalHeaders,
  Fetcher,
  FetchResult,
} from "../contracts/index.js"

const NOT_FOUND: FetchResult = {
  status: 404,
  body: null,
  etag: null,
  lastModified: null,
  notModified: false,
}

export class FakeFetcher implements Fetcher {
  private readonly responses = new Map<string, FetchResult>()

  constructor(seed: Record<string, FetchResult> = {}) {
    for (const [url, result] of Object.entries(seed))
      this.responses.set(url, result)
  }

  set(url: string, result: FetchResult): this {
    this.responses.set(url, result)
    return this
  }

  async fetch(
    url: string,
    conditional?: ConditionalHeaders,
  ): Promise<FetchResult> {
    const result = this.responses.get(url)
    if (!result) return NOT_FOUND
    if (
      conditional?.ifNoneMatch &&
      result.etag &&
      conditional.ifNoneMatch === result.etag
    ) {
      return {
        status: 304,
        body: null,
        etag: result.etag,
        lastModified: result.lastModified,
        notModified: true,
      }
    }
    return result
  }
}
