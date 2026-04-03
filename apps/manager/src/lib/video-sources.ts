type Maybe<T> = T | null | undefined

export const TRUSTED_STAGE_CLONE_SOURCE_HOSTS = new Set([
  "stream.mux.com",
  "api-media-core.jesusfilm.org",
])

export type DownloadSourceLike = {
  url?: string | null
}

export type DownloadSourceVariantLike = {
  downloads?: Array<DownloadSourceLike | null> | null
}

export function isDownloadableMp4Url(url: Maybe<string>): url is string {
  if (!url) return false

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false
    }

    return parsed.pathname.toLowerCase().endsWith(".mp4")
  } catch {
    return false
  }
}

export function isTrustedStageCloneSourceUrl(
  url: Maybe<string>,
): url is string {
  if (!isDownloadableMp4Url(url)) {
    return false
  }

  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === "https:" &&
      TRUSTED_STAGE_CLONE_SOURCE_HOSTS.has(parsed.hostname)
    )
  } catch {
    return false
  }
}

export function hasDownloadableMp4(
  variants: Maybe<Array<DownloadSourceVariantLike | null>>,
): boolean {
  return (variants ?? []).some((variant) =>
    (variant?.downloads ?? []).some((download) =>
      isTrustedStageCloneSourceUrl(download?.url),
    ),
  )
}

export function redactSourceUrlForMetadata(url: string): {
  sourceInputOrigin: string
  sourceInputPathname: string
} {
  const parsed = new URL(url)

  return {
    sourceInputOrigin: parsed.origin,
    sourceInputPathname: parsed.pathname,
  }
}
