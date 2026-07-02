// Same-origin streaming proxy for video downloads.
//
// Browsers ignore the `<a download>` attribute on cross-origin URLs and
// instead navigate to them, opening the video in a new tab. Routing the
// download through this same-origin endpoint with `Content-Disposition:
// attachment` set lets the browser hand the file to its download manager
// without buffering the response in JS memory (we stream the upstream
// `ReadableStream` directly into the response).

import { promises as dns } from "node:dns"
import { isIP } from "node:net"

import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import {
  SAFE_DOWNLOAD_EXTENSIONS,
  isAllowedDownloadOrigin,
} from "@/lib/download-allowlist"
import { resolveWatchDownloadTarget } from "@/lib/download-target"
import { verifyAuthSession } from "@/lib/auth-session"
import { recordWatchEventWithAccessToken } from "@/lib/watch-event-actions"

// Use the Node runtime so streaming bodies are fully supported across
// hosts. The Edge runtime would also work, but Node gives us long
// timeouts for multi-GB feature-film downloads.
export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"
// Cap the worst-case route lifetime. Most feature-film downloads finish
// well under 10 minutes; longer than that and the connection has stalled.
export const maxDuration = 600

const ALLOWED_DOWNLOAD_HEADERS = [
  "content-type",
  "content-length",
  // Required on 206 Partial Content per RFC 7233 §4.1 — without it the
  // browser cannot validate the byte slice received and cannot resume an
  // interrupted download.
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const

// Conditional/Range headers the browser sends to validate a resumable
// download. Forwarded as a unit so the upstream can return 206 + matching
// validators (or 412 if the asset has rotated).
const CLIENT_CONDITIONAL_HEADERS = [
  "range",
  "if-range",
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
] as const

// Header values are 1*( field-vchar / SP / HTAB ); reject any control char
// to prevent CRLF injection (a smuggled "\r\nSet-Cookie: ..." filename
// could split the response). encodeURIComponent encodes CR/LF in the
// `filename*=UTF-8''...` form, but the `filename="..."` form is plain.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g
// RTL-override + invisible-direction-control codepoints used in
// extension-spoof filename attacks (e.g. `invoice‮gnp.exe` → renders
// as `invoiceexe.png` in the download UI).
const BIDI_CONTROL_RE = /[‪-‮⁦-⁩]/g
// Path separators and shell-meta characters that have no business in a
// `Content-Disposition: filename` value.
const FILENAME_UNSAFE_RE = /[\\/;,"]/g
const MAX_DOWNLOAD_FILENAME_LENGTH = 200

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

async function requireDownloadAccount(request: Request): Promise<
  | {
      ok: true
      session: Awaited<ReturnType<typeof verifyAuthSession>> & {
        authenticated: true
      }
    }
  | { ok: false; response: Response }
> {
  const session = await verifyAuthSession(request.headers)
  if (session.authenticated) {
    return { ok: true, session }
  }

  return {
    ok: false,
    response: jsonError("Authentication required", 401),
  }
}

// IPv4 ranges to reject for SSRF defense. RFC 1918 private space + loopback +
// link-local (cloud-metadata 169.254.169.254 lives here). We resolve DNS
// ourselves before the fetch and reject any result that lands in these
// ranges — closes DNS-rebinding via subdomain-takeover even though the
// hostname is allowlisted.
function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 0) return true
  if (a >= 224) return true // multicast / reserved
  return false
}

// IPv6 ranges to reject. Loopback (::1), link-local (fe80::/10),
// unique local (fc00::/7), IPv4-mapped (::ffff:0:0/96) — the last lets a
// rogue resolver smuggle an internal IPv4 through an IPv6 result.
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === "::1" || lower === "::") return true
  if (lower.startsWith("fe8") || lower.startsWith("fe9")) return true
  if (lower.startsWith("fea") || lower.startsWith("feb")) return true
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7)
    if (isIP(v4) === 4 && isPrivateIPv4(v4)) return true
  }
  return false
}

/**
 * Resolves the hostname and rejects if any answer is a private / loopback /
 * link-local / multicast / reserved IP. Standard SSRF defense (OWASP cheat
 * sheet) — closes DNS-rebinding via subdomain takeover that the hostname
 * allowlist alone cannot see. A narrow TOCTOU window remains between this
 * resolution and undici's own resolution at fetch time; for our threat
 * model (allowlist of two operator-trusted domains) that gap is
 * acceptable. To close it atomically we'd need an undici dispatcher that
 * pins the resolved IP, which the platform doesn't expose natively.
 */
async function resolvesToPublicIp(hostname: string): Promise<boolean> {
  // Skip resolution if the hostname IS already an IP literal — `URL`
  // accepts those and we still need to validate them.
  const literal = isIP(hostname)
  if (literal === 4) return !isPrivateIPv4(hostname)
  if (literal === 6) return !isPrivateIPv6(hostname)

  const resolutions = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ])
  const ips: string[] = []
  for (const r of resolutions) {
    if (r.status === "fulfilled") ips.push(...r.value)
  }
  if (ips.length === 0) {
    // No DNS answer at all — let the fetch surface the failure rather
    // than guessing here.
    return true
  }
  return ips.every((ip) => !(isPrivateIPv4(ip) || isPrivateIPv6(ip)))
}

function sanitizeFilename(raw: string): string {
  const stripped = raw
    .replace(CONTROL_CHARS_RE, "")
    .replace(BIDI_CONTROL_RE, "")
    .replace(FILENAME_UNSAFE_RE, "")
    .trim()
  // After stripping, optionally trim trailing dots/spaces (Windows-hostile)
  // and clamp length to prevent absurd filenames in error logs.
  const trimmed = stripped.replace(/[.\s]+$/, "")
  if (trimmed.length === 0) return "download"

  // Enforce extension allowlist tied to media-only payloads.
  const lastDot = trimmed.lastIndexOf(".")
  const hasExtension = lastDot > 0 && lastDot < trimmed.length - 1
  const rawExtension = hasExtension ? trimmed.slice(lastDot) : ""
  const normalizedExtension = rawExtension.slice(1).toLowerCase()
  const extension = hasExtension
    ? SAFE_DOWNLOAD_EXTENSIONS.has(normalizedExtension)
      ? rawExtension
      : ".mp4"
    : ""
  const rawBasename = hasExtension ? trimmed.slice(0, lastDot) : trimmed
  const maxBasenameLength = MAX_DOWNLOAD_FILENAME_LENGTH - extension.length
  const basename =
    rawBasename.slice(0, maxBasenameLength).replace(/[.\s]+$/, "") || "download"
  return `${basename}${extension}`
}

// Logs origin + path only; signed-URL JWTs and other secrets in query
// strings stay out of the log retention window.
function safeLogUrl(target: string): string {
  try {
    const u = new URL(target)
    return `${u.origin}${u.pathname}`
  } catch {
    return "<unparseable>"
  }
}

// Discriminated union — callers branch on `ok` (a literal tag) rather
// than `in`-narrowing on a structural field name. A future caller that
// misspells the variant field will produce a type error instead of
// silently reading `undefined`.
type ValidateTargetResult =
  | { ok: true; safeUrl: string }
  | { ok: false; errorResponse: NextResponse }

type ResolveTargetResult =
  | {
      ok: true
      target: string
      event?: {
        videoId: string
        videoDubId: string
        languageId: string | null
      }
    }
  | { ok: false; errorResponse: NextResponse }

async function resolveRequestedTarget(
  searchParams: URLSearchParams,
): Promise<ResolveTargetResult> {
  const legacyTarget = searchParams.get("url")
  if (legacyTarget) return { ok: true, target: legacyTarget }

  const resolved = await resolveWatchDownloadTarget({
    downloadId: searchParams.get("downloadId"),
    variantId: searchParams.get("variantId"),
    videoSlug: searchParams.get("videoSlug"),
  })

  if (resolved.ok) {
    return { ok: true, target: resolved.url, event: resolved.event }
  }
  if (resolved.reason === "missing-params") {
    return {
      ok: false,
      errorResponse: jsonError(
        "Missing required `url` or download identifiers",
        400,
      ),
    }
  }
  if (resolved.reason === "unavailable") {
    return {
      ok: false,
      errorResponse: jsonError("Download lookup unavailable", 503),
    }
  }
  return {
    ok: false,
    errorResponse: jsonError("Download unavailable", 404),
  }
}

// Validates the `?url=` target against the allowlist + DNS pre-flight and
// returns a sanitized URL string ready to fetch. Shared by GET (stream) and
// HEAD (size probe) so both methods enforce the same SSRF defenses.
async function validateTarget(
  target: string | null,
): Promise<ValidateTargetResult> {
  if (!target) {
    return {
      ok: false,
      errorResponse: jsonError("Missing required `url` parameter", 400),
    }
  }
  if (!isAllowedDownloadOrigin(target)) {
    console.error("[api/download] rejected non-allowlisted target", {
      origin: (() => {
        try {
          return new URL(target).origin
        } catch {
          return "<unparseable>"
        }
      })(),
    })
    return { ok: false, errorResponse: jsonError("Forbidden", 403) }
  }
  const parsed = new URL(target)
  try {
    if (!(await resolvesToPublicIp(parsed.hostname))) {
      console.error("[api/download] rejected non-public IP resolution", {
        host: parsed.hostname,
      })
      return { ok: false, errorResponse: jsonError("Forbidden", 403) }
    }
  } catch (err) {
    console.error("[api/download] DNS pre-flight failed", {
      host: parsed.hostname,
      err: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, errorResponse: jsonError("Forbidden", 403) }
  }
  // Reconstruct from validated components only. Drops userinfo
  // (`https://user:pass@host/`) and fragment that survived the hostname
  // allowlist check.
  return { ok: true, safeUrl: parsed.origin + parsed.pathname + parsed.search }
}

// Builds an abort signal that combines the client's request signal with a
// connect-phase timeout, so a stalled CDN can't pin a Node worker forever.
// Returned `clear()` MUST be called in a `finally` to release the timer.
// Choose `timeoutMs` strictly less than the route's `maxDuration`; if the
// platform ceiling fires first, the signal never aborts and the upstream
// classifier may declare a stalled connection a network error.
function buildUpstreamSignal(
  request: Request,
  timeoutMs: number,
): { signal: AbortSignal; clear: () => void } {
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)
  const signal =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any([request.signal, timeoutController.signal])
      : timeoutController.signal
  return { signal, clear: () => clearTimeout(timeoutId) }
}

export async function GET(request: Request): Promise<Response> {
  const authGate = await requireDownloadAccount(request)
  if (!authGate.ok) return authGate.response

  const { searchParams } = new URL(request.url)
  const rawFilename = searchParams.get("filename")
  const contentDisposition =
    searchParams.get("disposition") === "inline" ? "inline" : "attachment"

  const resolvedTarget = await resolveRequestedTarget(searchParams)
  if (!resolvedTarget.ok) {
    return resolvedTarget.errorResponse
  }

  const validation = await validateTarget(resolvedTarget.target)
  if (!validation.ok) {
    return validation.errorResponse
  }
  const { safeUrl } = validation

  const filename = sanitizeFilename(rawFilename ?? "download")

  // Forward Range + the rest of the conditional-request headers so the
  // browser's download manager can resume cleanly: Range tells the
  // upstream which byte slice to send; If-Range / If-None-Match let the
  // upstream return 412 if the asset has rotated mid-download (preventing
  // a silently-corrupt stitched file).
  const upstreamHeaders: HeadersInit = {}
  for (const name of CLIENT_CONDITIONAL_HEADERS) {
    const value = request.headers.get(name)
    if (value) upstreamHeaders[name] = value
  }

  // 30s connect-phase timeout — generous because the GET path streams
  // multi-GB feature-film downloads. Must remain strictly less than the
  // route's `maxDuration` (600s).
  const { signal, clear: clearUpstreamTimeout } = buildUpstreamSignal(
    request,
    30_000,
  )

  let upstream: Response
  try {
    // SSRF mitigations layered for this call:
    //   1. `isAllowedDownloadOrigin(target)` rejects non-HTTPS and
    //      non-allowlisted hostnames before we get here.
    //   2. `safeUrl` is reconstructed from `parsed.origin/pathname/search`
    //      so userinfo and fragment are dropped.
    //   3. `resolvesToPublicIp` rejects private/loopback/link-local DNS
    //      results so subdomain-takeover-via-DNS-rebinding can't smuggle
    //      an internal IP through an allowlisted hostname.
    //   4. `redirect: "manual"` blocks any 3xx the upstream might use to
    //      pivot to a non-allowlisted origin.
    //   5. `headers: upstreamHeaders` only contains the client's
    //      conditional-request headers (Range / If-Range / etc.) — no
    //      cookies, no Authorization. Node's fetch doesn't forward them
    //      cross-origin by default.
    //   6. `signal` is bounded by a 30s connect timeout and the client's
    //      abort signal, so a stalled CDN can't pin a Node worker.
    // CodeQL's `js/request-forgery` doesn't model any of these as
    // sanitizers (per RequestForgeryCustomizations.qll — only
    // `UriEncodingSanitizer` and models-as-data barriers are recognized).
    // codeql[js/request-forgery]
    upstream = await fetch(safeUrl, {
      headers: upstreamHeaders,
      redirect: "manual",
      signal,
    })
  } catch (err) {
    if (request.signal.aborted) {
      // Client disconnected first — no point logging or returning a body
      // the client will never read.
      return new NextResponse(null, { status: 499 })
    }
    console.error("[api/download] upstream fetch failed", {
      target: safeLogUrl(safeUrl),
      err: err instanceof Error ? err.message : String(err),
    })
    return jsonError("Upstream fetch failed", 502)
  } finally {
    clearUpstreamTimeout()
  }

  // `redirect: "manual"` surfaces 3xx as `type === "opaqueredirect"` with
  // status 0; treat any non-200/non-206 as upstream failure.
  if (
    upstream.type === "opaqueredirect" ||
    (upstream.status >= 300 && upstream.status < 400)
  ) {
    console.error("[api/download] upstream attempted redirect", {
      target: safeLogUrl(safeUrl),
    })
    return jsonError("Upstream redirected; refusing to follow", 502)
  }

  if (!upstream.ok && upstream.status !== 206) {
    console.error("[api/download] upstream non-OK", {
      target: safeLogUrl(safeUrl),
      status: upstream.status,
    })
    return jsonError(`Upstream ${upstream.status}`, upstream.status)
  }

  if (!upstream.body) {
    return jsonError("Upstream had no body", 502)
  }

  if (authGate.session.accessToken && resolvedTarget.event) {
    void recordWatchEventWithAccessToken(authGate.session.accessToken, {
      eventType: "download",
      videoId: resolvedTarget.event.videoId,
      videoDubId: resolvedTarget.event.videoDubId,
      languageId: resolvedTarget.event.languageId,
    }).then((result) => {
      if (!result.ok) {
        console.warn("[api/download] failed to record download watch event", {
          videoId: resolvedTarget.event?.videoId,
          videoDubId: resolvedTarget.event?.videoDubId,
          reason: result.reason,
        })
      }
    })
  }

  const headers = new Headers()
  for (const name of ALLOWED_DOWNLOAD_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  // RFC 6266 — quoted filename for legacy clients + filename* with UTF-8
  // for non-ASCII. Both forms get the sanitized name; `encodeURIComponent`
  // encodes any character that isn't safe in a header token.
  const encodedName = encodeURIComponent(filename)
  headers.set(
    "Content-Disposition",
    `${contentDisposition}; filename="${filename}"; filename*=UTF-8''${encodedName}`,
  )
  headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate")
  // Don't let the browser/CDN sniff the response and override our content type.
  headers.set("X-Content-Type-Options", "nosniff")

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  })
}

// HEAD probes the upstream for `Content-Length` only — used by the
// download modal to fill in real file sizes when the CMS `size` field
// is missing or zero. Reuses the same SSRF defenses as GET (allowlist,
// DNS pre-flight, manual redirect handling); body is never read.
export async function HEAD(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)

  const resolvedTarget = await resolveRequestedTarget(searchParams)
  if (!resolvedTarget.ok) {
    return resolvedTarget.errorResponse
  }

  const validation = await validateTarget(resolvedTarget.target)
  if (!validation.ok) {
    return validation.errorResponse
  }
  const { safeUrl } = validation

  // 10s is generous for a metadata-only round trip; longer than that and
  // the CDN has effectively timed out. Tighter than GET's 30s because a
  // HEAD probe should never need to wait that long, and the client (the
  // download modal) is willing to fall back to no size display.
  const { signal, clear: clearUpstreamTimeout } = buildUpstreamSignal(
    request,
    10_000,
  )

  let upstream: Response
  try {
    // codeql[js/request-forgery]
    upstream = await fetch(safeUrl, {
      method: "HEAD",
      redirect: "manual",
      signal,
    })
  } catch (err) {
    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 })
    }
    console.error("[api/download] HEAD upstream fetch failed", {
      target: safeLogUrl(safeUrl),
      err: err instanceof Error ? err.message : String(err),
    })
    return jsonError("Upstream fetch failed", 502)
  } finally {
    clearUpstreamTimeout()
  }

  if (
    upstream.type === "opaqueredirect" ||
    (upstream.status >= 300 && upstream.status < 400)
  ) {
    console.error("[api/download] HEAD upstream attempted redirect", {
      target: safeLogUrl(safeUrl),
    })
    return jsonError("Upstream redirected; refusing to follow", 502)
  }

  // Mirror GET: a 206 Partial Content is a valid metadata response from
  // some CDNs, not an error. Returning 502 here would make legitimate
  // sizes invisible to the client.
  if (!upstream.ok && upstream.status !== 206) {
    return jsonError(`Upstream ${upstream.status}`, upstream.status)
  }

  const headers = new Headers()
  // Only forward the metadata fields the modal needs; specifically not
  // Set-Cookie or any tracking headers that may ride on a HEAD response.
  for (const name of ["content-length", "content-type"] as const) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  // Browsers cache HEAD responses keyed with GET, so we'd rather they
  // not — the CMS may correct sizes between modal opens.
  headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate")
  headers.set("X-Content-Type-Options", "nosniff")

  // Forward upstream's status (200 or 206) so callers see exactly what
  // the CDN reported — mirroring GET's pass-through behavior.
  return new NextResponse(null, { status: upstream.status, headers })
}
