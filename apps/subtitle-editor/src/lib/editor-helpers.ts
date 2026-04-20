export const MIN_SUPPORTED_VIEWPORT_WIDTH = 1024

export type LaunchEnvelope = {
  jobId: string
  launchCode: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function base64UrlEncode(text: string): string {
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(text)
    let binary = ""
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")
  }

  return Buffer.from(text, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}

function base64UrlDecode(text: string): string {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/")
  const normalized = `${padded}${"=".repeat((4 - (padded.length % 4 || 4)) % 4)}`
  if (typeof atob === "function") {
    const binary = atob(normalized)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    return new TextDecoder().decode(bytes)
  }

  return Buffer.from(normalized, "base64").toString("utf8")
}

export function encodeLaunchEnvelope(envelope: LaunchEnvelope): string {
  return base64UrlEncode(JSON.stringify(envelope))
}

export function decodeLaunchEnvelope(value: string): LaunchEnvelope | null {
  if (!value) {
    return null
  }

  try {
    const decoded = JSON.parse(base64UrlDecode(value))
    if (
      isRecord(decoded) &&
      typeof decoded.jobId === "string" &&
      typeof decoded.launchCode === "string" &&
      decoded.jobId.trim().length > 0 &&
      decoded.launchCode.trim().length > 0
    ) {
      return {
        jobId: decoded.jobId,
        launchCode: decoded.launchCode,
      }
    }
  } catch {
    // fall through to legacy delimiter formats
  }

  const separators = ["::", "|", ":"]
  for (const separator of separators) {
    const index = value.indexOf(separator)
    if (index > 0 && index < value.length - separator.length) {
      const jobId = value.slice(0, index).trim()
      const launchCode = value.slice(index + separator.length).trim()
      if (jobId && launchCode) {
        return { jobId, launchCode }
      }
    }
  }

  return null
}

export function isSupportedViewportWidth(width: number): boolean {
  return width >= MIN_SUPPORTED_VIEWPORT_WIDTH
}

export function buildManagerJobUrl(
  managerBaseUrl: string,
  jobId: string,
): string {
  return new URL(
    `/dashboard/jobs/${encodeURIComponent(jobId)}`,
    managerBaseUrl,
  ).toString()
}
