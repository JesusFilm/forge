// Same-origin download resolver.
//
// Browsers ignore the `<a download>` attribute on cross-origin URLs and
// instead navigate to them, opening the video in a new tab. Routing the
// click through this same-origin endpoint lets Web keep opaque download IDs,
// auth gating, and event recording without exposing raw CDN URLs in rendered
// markup. Successful attachment downloads redirect to the CDN so Web does not
// carry media streams.

import { promises as dns } from "node:dns"
import { isIP } from "node:net"

import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import { isAllowedDownloadOrigin } from "@/lib/download-allowlist"
import { readWatchDownloadCapability } from "@/lib/watch-download-capability"
import { resolveWatchDownloadTarget } from "@/lib/download-target"
import { resolveWatchSubtitleTarget } from "@/lib/subtitle-target"
import {
  isWatchDownloadAccountGateEnabled,
  watchDownloadAccountGateFlagContext,
} from "@/lib/feature-flags"
import { verifyAuthSession } from "@/lib/auth-session"
import { recordWatchEventWithAccessToken } from "@/lib/watch-event-actions"
import {
  WATCH_DOWNLOAD_AUTH_REQUIRED,
  WATCH_DOWNLOAD_ERROR_HEADER,
} from "@/lib/watch-download-contract"

// Use the Node runtime for DNS preflight before releasing a target URL.
export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const DEFAULT_DOWNLOAD_FILENAME = "download.mp4"
const MAX_DOWNLOAD_FILENAME_LENGTH = 200
const INLINE_SUBTITLE_TIMEOUT_MS = 30_000
const DOWNLOAD_CACHE_CONTROL = "private, no-cache, no-store, must-revalidate"
const INLINE_SUBTITLE_ORIGIN = "https://api-media-core.jesusfilm.org"

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g
const BIDI_CONTROL_RE = /[\u202a-\u202e\u2066-\u2069]/g
const FILENAME_UNSAFE_RE = /[\\/;,"]/g

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

function isAnonymousInlineSubtitleRequest(
  searchParams: URLSearchParams,
): boolean {
  if (searchParams.get("disposition") !== "inline") return false
  return Boolean(
    searchParams.get("subtitleId") && searchParams.get("variantId"),
  )
}

function buildInlineSubtitleFetchUrl(target: string): string | null {
  try {
    const parsed = new URL(target)
    if (parsed.origin !== INLINE_SUBTITLE_ORIGIN || parsed.search) return null

    const encodedSegments: string[] = []
    for (const rawSegment of parsed.pathname.split("/")) {
      const segment = decodeURIComponent(rawSegment)
      if (
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\")
      ) {
        return null
      }
      encodedSegments.push(encodeURIComponent(segment))
    }
    const encodedPath = encodedSegments.join("/")
    if (!encodedPath.toLowerCase().endsWith(".vtt")) return null

    return `${INLINE_SUBTITLE_ORIGIN}${encodedPath}`
  } catch {
    return null
  }
}

async function resolveDownloadAccountGate(
  request: Request,
  allowAuthExemptInlineSubtitle: boolean,
): Promise<
  | {
      ok: true
      accountGateEnabled: boolean
      session?: Awaited<ReturnType<typeof verifyAuthSession>> & {
        authenticated: true
      }
    }
  | { ok: false; response: Response }
> {
  const accountGateEnabled = await isWatchDownloadAccountGateEnabled(
    watchDownloadAccountGateFlagContext,
  )
  if (!accountGateEnabled || allowAuthExemptInlineSubtitle) {
    return { ok: true, accountGateEnabled }
  }

  const session = await verifyAuthSession(request.headers)
  if (session.authenticated) {
    return { ok: true, accountGateEnabled: true, session }
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: "Authentication required" },
      {
        status: 401,
        headers: {
          [WATCH_DOWNLOAD_ERROR_HEADER]: WATCH_DOWNLOAD_AUTH_REQUIRED,
        },
      },
    ),
  }
}

// IPv4 ranges to reject for SSRF defense. RFC 1918 private space + loopback +
// link-local (cloud-metadata 169.254.169.254 lives here). We resolve DNS
// ourselves before redirecting and reject any result that lands in these
// ranges; closes DNS-rebinding via subdomain-takeover even though the
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
 * resolution and the browser/CDN request after redirect. For our threat model
 * (allowlist of operator-trusted domains) that gap is acceptable and keeps Web
 * out of the response body path.
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
    // No DNS answer at all: allow the browser/CDN request to surface the
    // failure rather than guessing here.
    return true
  }
  return ips.every((ip) => !(isPrivateIPv4(ip) || isPrivateIPv6(ip)))
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
  options: {
    allowLegacyTarget: boolean
    requiredSubject?: string
  } = { allowLegacyTarget: true },
): Promise<ResolveTargetResult> {
  const capabilityToken = searchParams.get("capability")
  if (searchParams.has("capability")) {
    const capability = await readWatchDownloadCapability(capabilityToken)
    if (
      !capability ||
      capability.downloadId !== searchParams.get("downloadId") ||
      capability.variantId !== searchParams.get("variantId") ||
      capability.videoSlug !== searchParams.get("videoSlug") ||
      (options.requiredSubject !== undefined &&
        capability.subject !== options.requiredSubject)
    ) {
      return {
        ok: false,
        errorResponse: jsonError("Download unavailable", 404),
      }
    }
    return {
      ok: true,
      target: capability.target,
      event: capability.event,
    }
  }

  const legacyTarget = searchParams.get("url")
  if (legacyTarget) {
    if (options.allowLegacyTarget) return { ok: true, target: legacyTarget }
    return {
      ok: false,
      errorResponse: jsonError("Download identifiers required", 400),
    }
  }

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

// Validates the target against the allowlist + DNS pre-flight and returns a
// sanitized URL string ready to redirect. Shared by GET and HEAD so both
// methods enforce the same SSRF defenses.
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

function redirectToTarget(safeUrl: string): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: safeUrl,
      "Cache-Control": DOWNLOAD_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function safeLogUrl(target: string): string {
  try {
    const url = new URL(target)
    return url.origin + url.pathname
  } catch {
    return "<unparseable>"
  }
}

function discardResponseBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined)
}

function streamResponseBody(
  body: ReadableStream<Uint8Array>,
  clearSubtitleTimeout: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader()

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          clearSubtitleTimeout()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        clearSubtitleTimeout()
        controller.error(error)
      }
    },
    async cancel(reason) {
      clearSubtitleTimeout()
      await reader.cancel(reason)
    },
  })
}

async function proxyInlineSubtitle(
  request: Request,
  safeUrl: string,
): Promise<Response> {
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    INLINE_SUBTITLE_TIMEOUT_MS,
  )
  const clearSubtitleTimeout = () => clearTimeout(timeoutId)
  const signal =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any([request.signal, timeoutController.signal])
      : timeoutController.signal

  let upstream: Response
  try {
    // The validated VTT must remain same-origin for native <track> loading.
    // Following a redirect here could bypass the target allowlist, so surface
    // upstream redirects as a controlled failure instead.
    // codeql[js/request-forgery]
    upstream = await fetch(safeUrl, {
      headers: { Accept: "text/vtt" },
      method: request.method === "HEAD" ? "HEAD" : "GET",
      redirect: "manual",
      signal,
    })
  } catch (error) {
    clearSubtitleTimeout()
    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 })
    }
    console.error("[api/download] inline subtitle fetch failed", {
      target: safeLogUrl(safeUrl),
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonError("Upstream subtitle fetch failed", 502)
  }

  if (
    upstream.type === "opaqueredirect" ||
    (upstream.status >= 300 && upstream.status < 400)
  ) {
    clearSubtitleTimeout()
    discardResponseBody(upstream)
    console.error("[api/download] inline subtitle upstream redirected", {
      target: safeLogUrl(safeUrl),
    })
    return jsonError("Upstream subtitle redirected; refusing to follow", 502)
  }

  if (!upstream.ok) {
    clearSubtitleTimeout()
    discardResponseBody(upstream)
    return jsonError(`Upstream ${upstream.status}`, upstream.status)
  }

  const contentType = upstream.headers.get("content-type")
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "text/vtt") {
    clearSubtitleTimeout()
    discardResponseBody(upstream)
    console.error("[api/download] rejected non-VTT inline subtitle response", {
      target: safeLogUrl(safeUrl),
      contentType,
    })
    return jsonError("Upstream subtitle response was not VTT", 502)
  }

  const headers = new Headers({
    "Cache-Control": DOWNLOAD_CACHE_CONTROL,
    "Content-Disposition": "inline",
    "Content-Type": contentType ?? "text/vtt",
    "X-Content-Type-Options": "nosniff",
  })

  if (request.method === "HEAD") {
    clearSubtitleTimeout()
    discardResponseBody(upstream)
    return new NextResponse(null, { status: upstream.status, headers })
  }

  if (!upstream.body) {
    clearSubtitleTimeout()
    return jsonError("Upstream subtitle had no body", 502)
  }

  return new NextResponse(
    streamResponseBody(upstream.body, clearSubtitleTimeout),
    {
      status: upstream.status,
      headers,
    },
  )
}

function sanitizeDownloadFilename(raw: string | null): string {
  const stripped = (raw ?? DEFAULT_DOWNLOAD_FILENAME)
    .replace(CONTROL_CHARS_RE, "")
    .replace(BIDI_CONTROL_RE, "")
    .replace(FILENAME_UNSAFE_RE, "")
    .trim()
    .replace(/[.\s]+$/, "")

  const filename = stripped || DEFAULT_DOWNLOAD_FILENAME
  const basename = filename.toLowerCase().endsWith(".mp4")
    ? filename.slice(0, -4)
    : filename
  return `${basename.slice(0, MAX_DOWNLOAD_FILENAME_LENGTH - 4)}.mp4`
}

function fallbackFilenameFromTarget(safeUrl: string): string {
  try {
    const pathname = new URL(safeUrl).pathname
    const basename = pathname.split("/").filter(Boolean).at(-1)
    return sanitizeDownloadFilename(basename ?? null)
  } catch {
    return DEFAULT_DOWNLOAD_FILENAME
  }
}

function attachmentRedirectUrl(input: {
  disposition: "attachment" | "inline"
  filename: string | null
  safeUrl: string
}): string {
  if (input.disposition !== "attachment") return input.safeUrl

  const target = new URL(input.safeUrl)
  if (
    target.hostname !== "stream.mux.com" ||
    !target.pathname.toLowerCase().endsWith(".mp4")
  ) {
    return input.safeUrl
  }

  target.searchParams.set(
    "download",
    input.filename
      ? sanitizeDownloadFilename(input.filename)
      : fallbackFilenameFromTarget(input.safeUrl),
  )
  return target.toString()
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const anonymousInlineSubtitleRequest =
    isAnonymousInlineSubtitleRequest(searchParams)
  const disposition =
    searchParams.get("disposition") === "inline" ? "inline" : "attachment"
  const authGate = await resolveDownloadAccountGate(
    request,
    anonymousInlineSubtitleRequest,
  )
  if (!authGate.ok) return authGate.response

  let target: string
  let downloadEvent:
    | { videoId: string; videoDubId: string; languageId: string | null }
    | undefined

  if (anonymousInlineSubtitleRequest) {
    const subtitleTarget = await resolveWatchSubtitleTarget({
      subtitleId: searchParams.get("subtitleId"),
      variantId: searchParams.get("variantId"),
    })
    if (!subtitleTarget.ok) {
      if (subtitleTarget.reason === "missing-params") {
        return jsonError("Subtitle identifiers required", 400)
      }
      if (subtitleTarget.reason === "unavailable") {
        return jsonError("Subtitle lookup unavailable", 503)
      }
      return jsonError("Subtitle unavailable", 404)
    }
    target = subtitleTarget.target
  } else {
    const downloadTarget = await resolveRequestedTarget(searchParams, {
      allowLegacyTarget: authGate.accountGateEnabled,
      requiredSubject: authGate.accountGateEnabled
        ? (authGate.session?.userId ?? "")
        : undefined,
    })
    if (!downloadTarget.ok) return downloadTarget.errorResponse
    target = downloadTarget.target
    downloadEvent = downloadTarget.event
  }

  const validation = await validateTarget(target)
  if (!validation.ok) {
    return validation.errorResponse
  }
  const { safeUrl } = validation

  if (anonymousInlineSubtitleRequest) {
    const inlineSubtitleUrl = buildInlineSubtitleFetchUrl(safeUrl)
    if (!inlineSubtitleUrl) return jsonError("Forbidden", 403)
    return proxyInlineSubtitle(request, inlineSubtitleUrl)
  }

  if (authGate.session?.accessToken && downloadEvent) {
    const result = await recordWatchEventWithAccessToken(
      authGate.session.accessToken,
      {
        eventType: "download",
        videoId: downloadEvent.videoId,
        videoDubId: downloadEvent.videoDubId,
        languageId: downloadEvent.languageId,
      },
    )
    if (!result.ok) {
      console.warn("[api/download] failed to record download watch event", {
        videoId: downloadEvent.videoId,
        videoDubId: downloadEvent.videoDubId,
        reason: result.reason,
      })
    }
  }

  return redirectToTarget(
    attachmentRedirectUrl({
      disposition,
      filename: searchParams.get("filename"),
      safeUrl,
    }),
  )
}

export async function HEAD(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)

  if (isAnonymousInlineSubtitleRequest(searchParams)) {
    const subtitleTarget = await resolveWatchSubtitleTarget({
      subtitleId: searchParams.get("subtitleId"),
      variantId: searchParams.get("variantId"),
    })
    if (!subtitleTarget.ok) {
      if (subtitleTarget.reason === "missing-params") {
        return jsonError("Subtitle identifiers required", 400)
      }
      if (subtitleTarget.reason === "unavailable") {
        return jsonError("Subtitle lookup unavailable", 503)
      }
      return jsonError("Subtitle unavailable", 404)
    }

    const validation = await validateTarget(subtitleTarget.target)
    if (!validation.ok) return validation.errorResponse
    const inlineSubtitleUrl = buildInlineSubtitleFetchUrl(validation.safeUrl)
    if (!inlineSubtitleUrl) return jsonError("Forbidden", 403)
    return proxyInlineSubtitle(request, inlineSubtitleUrl)
  }

  const authGate = await resolveDownloadAccountGate(request, false)
  if (!authGate.ok) return authGate.response

  const resolvedTarget = await resolveRequestedTarget(searchParams, {
    allowLegacyTarget: authGate.accountGateEnabled,
    requiredSubject: authGate.accountGateEnabled
      ? (authGate.session?.userId ?? "")
      : undefined,
  })
  if (!resolvedTarget.ok) {
    return resolvedTarget.errorResponse
  }

  const validation = await validateTarget(resolvedTarget.target)
  if (!validation.ok) {
    return validation.errorResponse
  }
  const { safeUrl } = validation

  return redirectToTarget(
    attachmentRedirectUrl({
      disposition:
        searchParams.get("disposition") === "inline" ? "inline" : "attachment",
      filename: searchParams.get("filename"),
      safeUrl,
    }),
  )
}
