// Worker-side SSRF enforcement (plan decision 10). validateSourceUrl runs
// BEFORE any ffmpeg/ffprobe spawn that touches a request-supplied URL:
// re-parse with new URL, require https: AND an EXACT hostname match against
// the allowlist (case-insensitive, never endsWith — suffix spoofs like
// stream.mux.com.evil.com must fail). The S3 endpoint host is deliberately
// never allowlisted — artifacts move via the SDK, not ffmpeg.
//
// Non-production ONLY: http://127.0.0.1 is additionally allowed when
// "127.0.0.1" is explicitly in the allowlist — this enables the local smoke
// (scripts/smoke.ts) to serve a synthetic source over a loopback server.

import { env } from "./config/env.js"
import { WorkerError } from "./errors.js"

export class SourceUrlRejectedError extends WorkerError {
  constructor(message: string) {
    super(message, "source_rejected", false)
    this.name = "SourceUrlRejectedError"
  }
}

export function parseAllowedHosts(csv: string | undefined): string[] {
  if (!csv) return []
  return csv
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
}

export type ValidatedSourceUrl = {
  url: URL
  /** True only for the non-production http://127.0.0.1 smoke path. */
  loopbackHttp: boolean
}

export function validateSourceUrl(
  rawUrl: string,
  allowedHosts: string[] = parseAllowedHosts(
    env.SHORTS_WORKER_ALLOWED_SOURCE_HOSTS,
  ),
  isProduction: boolean = env.NODE_ENV === "production",
): ValidatedSourceUrl {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new SourceUrlRejectedError("source.url is not a parseable URL")
  }

  const hostname = parsed.hostname.toLowerCase()
  const hostAllowed = allowedHosts.includes(hostname)

  if (parsed.protocol === "https:") {
    if (!hostAllowed) {
      throw new SourceUrlRejectedError(
        `source host ${hostname} is not in the allowlist`,
      )
    }
    return { url: parsed, loopbackHttp: false }
  }

  if (
    !isProduction &&
    parsed.protocol === "http:" &&
    hostname === "127.0.0.1" &&
    hostAllowed
  ) {
    return { url: parsed, loopbackHttp: true }
  }

  throw new SourceUrlRejectedError(
    `source.url protocol ${parsed.protocol} is not allowed`,
  )
}
