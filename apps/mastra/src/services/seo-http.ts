import { isIP } from "node:net"
import { lookup } from "node:dns/promises"

export type SeoUrlFailureReason =
  | "invalid_url"
  | "scheme_not_allowed"
  | "host_not_allowed"
  | "credentials_not_allowed"
  | "query_not_allowed"
  | "private_address"
  | "dns_failed"

export type SeoSafeUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: SeoUrlFailureReason }

export function classifySeoHttpStatus(status: number): {
  reason: "auth_failed" | "rate_limited" | "network_error" | "rejected"
  retryable: boolean
  status: number
} {
  const reason =
    status === 401 || status === 403
      ? "auth_failed"
      : status === 429
        ? "rate_limited"
        : status >= 500
          ? "network_error"
          : "rejected"
  return {
    reason,
    retryable: status === 429 || status >= 500,
    status,
  }
}

type ResolveHost = (
  hostname: string,
) => Promise<readonly { address: string; family?: number }[]>

function ipv4Private(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true
  }
  const [a = 0, b = 0] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

export function isPrivateSeoAddress(address: string): boolean {
  const withoutBrackets =
    address.startsWith("[") && address.endsWith("]")
      ? address.slice(1, -1)
      : address
  const normalized =
    withoutBrackets.toLowerCase().split("%")[0] ?? withoutBrackets
  const family = isIP(normalized)
  if (family === 4) return ipv4Private(normalized)
  if (family !== 6) return true
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)
  if (mapped) return ipv4Private(mapped[1]!)
  const mappedHex = normalized.match(
    /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/u,
  )
  if (!mappedHex) return false
  const high = Number.parseInt(mappedHex[1]!, 16)
  const low = Number.parseInt(mappedHex[2]!, 16)
  return ipv4Private(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
}

const defaultResolveHost: ResolveHost = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true })

export async function validateSeoUrl(
  value: string | URL,
  options: {
    allowedHosts: readonly string[]
    allowQuery?: boolean
    resolveHost?: ResolveHost
  },
): Promise<SeoSafeUrlResult> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, reason: "invalid_url" }
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "scheme_not_allowed" }
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials_not_allowed" }
  }
  if (!options.allowQuery && url.search) {
    return { ok: false, reason: "query_not_allowed" }
  }
  const allowedHosts = new Set(
    options.allowedHosts.map((host) => host.toLowerCase()),
  )
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: "host_not_allowed" }
  }
  try {
    const hostname =
      url.hostname.startsWith("[") && url.hostname.endsWith("]")
        ? url.hostname.slice(1, -1)
        : url.hostname
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await (options.resolveHost ?? defaultResolveHost)(url.hostname)
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => isPrivateSeoAddress(address))
    ) {
      return { ok: false, reason: "private_address" }
    }
  } catch {
    return { ok: false, reason: "dns_failed" }
  }
  return { ok: true, url }
}

export async function readSeoBody(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  if (!response.body) return { ok: true, bytes: new Uint8Array() }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false }
      }
      chunks.push(next.value)
    }
  } catch {
    return { ok: false }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // The read result remains a safe failure if the stream already detached.
    }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

export async function readSeoJson(
  response: Response,
  maxBytes: number,
): Promise<unknown | undefined> {
  const body = await readSeoBody(response, maxBytes)
  if (!body.ok) return undefined
  try {
    return JSON.parse(new TextDecoder().decode(body.bytes))
  } catch {
    return undefined
  }
}

export async function fetchSeoUrl(
  initialUrl: string,
  options: {
    allowedHosts: readonly string[]
    timeoutMs: number
    maxBytes: number
    fetchImpl?: typeof fetch
    resolveHost?: ResolveHost
    maxRedirects?: number
    headers?: HeadersInit
  },
): Promise<
  | {
      ok: true
      url: string
      status: number
      headers: Headers
      body: Uint8Array
    }
  | {
      ok: false
      reason:
        | SeoUrlFailureReason
        | "timeout"
        | "network_error"
        | "body_too_large"
    }
> {
  let current = initialUrl
  const fetchImpl = options.fetchImpl ?? fetch
  for (
    let redirect = 0;
    redirect <= (options.maxRedirects ?? 3);
    redirect += 1
  ) {
    const safe = await validateSeoUrl(current, {
      allowedHosts: options.allowedHosts,
      resolveHost: options.resolveHost,
    })
    if (!safe.ok) return safe
    let response: Response
    try {
      response = await fetchImpl(safe.url, {
        headers: options.headers,
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs),
      })
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "timeout"
            : "network_error",
      }
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location || redirect === (options.maxRedirects ?? 3)) {
        return { ok: false, reason: "network_error" }
      }
      current = new URL(location, safe.url).toString()
      continue
    }
    const body = await readSeoBody(response, options.maxBytes)
    if (!body.ok) return { ok: false, reason: "body_too_large" }
    return {
      ok: true,
      url: safe.url.toString(),
      status: response.status,
      headers: response.headers,
      body: body.bytes,
    }
  }
  return { ok: false, reason: "network_error" }
}
