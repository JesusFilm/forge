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

import { isAllowedDownloadOrigin } from "@/lib/download-allowlist"

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

const SAFE_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
])

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
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
  const clamped = stripped.replace(/[.\s]+$/, "").slice(0, 200)
  if (clamped.length === 0) return "download"
  // Enforce extension allowlist tied to media-only payloads.
  const lastDot = clamped.lastIndexOf(".")
  if (lastDot > 0 && lastDot < clamped.length - 1) {
    const ext = clamped.slice(lastDot + 1).toLowerCase()
    if (!SAFE_EXTENSIONS.has(ext)) {
      return `${clamped.slice(0, lastDot)}.mp4`
    }
  }
  return clamped
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

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const target = searchParams.get("url")
  const rawFilename = searchParams.get("filename")

  if (!target) {
    return jsonError("Missing required `url` parameter", 400)
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
    return jsonError("Forbidden", 403)
  }

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

  // Combine the client's abort signal with our own connect-phase timeout
  // so a stalled CDN can't pin a Node worker forever. AbortSignal.any is
  // available on Node 20.5+ and supported by Vercel/Railway runtimes.
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), 30_000)
  const signal =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any([request.signal, timeoutController.signal])
      : timeoutController.signal

  // Re-parse and reconstruct from validated components only. Drops any
  // userinfo (`https://user:pass@host/`) and fragment that survived
  // `isAllowedDownloadOrigin`'s hostname-only check, so credentials
  // can't leak into the upstream request.
  const parsed = new URL(target)
  const safeUrl = parsed.origin + parsed.pathname + parsed.search

  // SSRF defense-in-depth: even though the hostname is allowlisted,
  // resolve DNS now and reject if any answer lands in private / loopback
  // / link-local space. Closes DNS-rebinding via subdomain takeover —
  // an attacker who claims a dangling `*.jesusfilm.org` CNAME could
  // otherwise repoint it at 127.0.0.1 or 169.254.169.254 (cloud
  // metadata). See OWASP SSRF Prevention Cheat Sheet.
  try {
    if (!(await resolvesToPublicIp(parsed.hostname))) {
      console.error("[api/download] rejected non-public IP resolution", {
        host: parsed.hostname,
      })
      return jsonError("Forbidden", 403)
    }
  } catch (err) {
    console.error("[api/download] DNS pre-flight failed", {
      host: parsed.hostname,
      err: err instanceof Error ? err.message : String(err),
    })
    return jsonError("Forbidden", 403)
  }

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
      target: safeLogUrl(target),
      err: err instanceof Error ? err.message : String(err),
    })
    return jsonError("Upstream fetch failed", 502)
  } finally {
    clearTimeout(timeoutId)
  }

  // `redirect: "manual"` surfaces 3xx as `type === "opaqueredirect"` with
  // status 0; treat any non-200/non-206 as upstream failure.
  if (
    upstream.type === "opaqueredirect" ||
    (upstream.status >= 300 && upstream.status < 400)
  ) {
    console.error("[api/download] upstream attempted redirect", {
      target: safeLogUrl(target),
    })
    return jsonError("Upstream redirected; refusing to follow", 502)
  }

  if (!upstream.ok && upstream.status !== 206) {
    console.error("[api/download] upstream non-OK", {
      target: safeLogUrl(target),
      status: upstream.status,
    })
    return jsonError(`Upstream ${upstream.status}`, upstream.status)
  }

  if (!upstream.body) {
    return jsonError("Upstream had no body", 502)
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
    `attachment; filename="${filename}"; filename*=UTF-8''${encodedName}`,
  )
  headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate")
  // Don't let the browser/CDN sniff the response and override our content type.
  headers.set("X-Content-Type-Options", "nosniff")

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  })
}
