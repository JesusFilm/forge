/**
 * Frame URL allowlisting for smart-crop vision calls.
 *
 * Frames arrive as caller-provided URLs that this runtime forwards to an
 * external vision provider, so every URL must be https and its hostname must
 * exactly match the configured allowlist (default `image.mux.com`).
 */

export const DEFAULT_FRAME_URL_ALLOWED_HOSTS = ["image.mux.com"] as const

export class SmartCropFrameUrlError extends Error {
  readonly reason = "frame_host_not_allowed" as const
  readonly retryable = false as const

  constructor(message: string) {
    super(message)
    this.name = "SmartCropFrameUrlError"
  }
}

export function parseAllowedFrameHosts(csv?: string): string[] {
  const hosts = (csv ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0)
  return hosts.length > 0 ? hosts : [...DEFAULT_FRAME_URL_ALLOWED_HOSTS]
}

export function assertAllowedFrameUrl(
  url: string,
  allowedHosts: readonly string[],
): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new SmartCropFrameUrlError(`frame URL is not a valid URL: ${url}`)
  }

  if (parsed.protocol !== "https:") {
    throw new SmartCropFrameUrlError(
      `frame URL must use https: ${parsed.protocol}//${parsed.hostname}`,
    )
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!allowedHosts.some((host) => host === hostname)) {
    throw new SmartCropFrameUrlError(
      `frame URL host is not allowlisted: ${hostname}`,
    )
  }
}
