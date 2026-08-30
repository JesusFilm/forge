import type {
  ConditionalHeaders,
  FetchDestinationPolicy,
  Fetcher,
  FetchResult,
} from "../../contracts/index.js"
import { isIP } from "node:net"
import { lookup } from "node:dns/promises"

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

type Resolver = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>

export type HttpFetcherOptions = {
  userAgent?: string
  timeoutMs?: number
  maxRedirects?: number
  resolveHost?: Resolver
}

const privateIpv4 = (address: string): boolean => {
  const [a, b] = address.split(".").map(Number)
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  )
}

const privateAddress = (address: string): boolean => {
  if (isIP(address) === 4) return privateIpv4(address)
  const normalized = address.toLowerCase()
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    (normalized.startsWith("::ffff:") &&
      privateIpv4(normalized.slice("::ffff:".length)))
  )
}

async function assertDestination(
  rawUrl: string,
  policy: FetchDestinationPolicy | undefined,
  resolver: Resolver,
): Promise<URL> {
  const url = new URL(rawUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(
      `fetch destination refused: unsupported protocol ${url.protocol}`,
    )
  if (url.username || url.password)
    throw new Error(
      "fetch destination refused: URL credentials are not allowed",
    )
  if (policy) {
    const allowed = policy.allowPatterns.map((pattern) => new RegExp(pattern))
    if (
      (allowed.length > 0 && !allowed.some((re) => re.test(url.href))) ||
      (allowed.length === 0 && url.hostname !== policy.expectedHost)
    )
      throw new Error(
        `fetch destination refused: ${url.href} is outside source policy`,
      )
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname, family: isIP(url.hostname) }]
    : await resolver(url.hostname)
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => privateAddress(address))
  )
    throw new Error(
      `fetch destination refused: ${url.hostname} resolves to a private or reserved address`,
    )
  return url
}

export class HttpFetcher implements Fetcher {
  constructor(private readonly options: HttpFetcherOptions = {}) {}

  async fetch(
    url: string,
    conditional?: ConditionalHeaders,
    destinationPolicy?: FetchDestinationPolicy,
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
      const resolver: Resolver =
        this.options.resolveHost ??
        ((hostname) => lookup(hostname, { all: true, verbatim: true }))
      let destination = await assertDestination(
        url,
        destinationPolicy,
        resolver,
      )
      let response: Response | undefined
      for (
        let redirects = 0;
        redirects <= (this.options.maxRedirects ?? 5);
        redirects++
      ) {
        response = await fetch(destination, {
          headers,
          redirect: "manual",
          signal: controller.signal,
        })
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        const location = response.headers.get("location")
        if (!location) break
        if (redirects === (this.options.maxRedirects ?? 5))
          throw new Error("fetch destination refused: redirect limit exceeded")
        destination = await assertDestination(
          new URL(location, destination).href,
          destinationPolicy,
          resolver,
        )
      }
      if (!response) throw new Error("fetch failed before receiving a response")
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
