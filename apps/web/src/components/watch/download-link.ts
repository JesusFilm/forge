import type { DownloadTier } from "@/components/watch/download-options"

// Same-origin streaming proxy. Hardcoded against `next.config.mjs`'s
// `basePath: "/watch"`; if the basePath ever moves, this string moves
// with it.
export const DOWNLOAD_PROXY_PATH = "/watch/api/download"

export type DownloadProxyParams = {
  downloadId: string
  filename?: string
  variantId: string
  videoSlug: string
}

export function buildDownloadProxyUrl({
  downloadId,
  filename,
  variantId,
  videoSlug,
}: DownloadProxyParams): string {
  const params = new URLSearchParams({
    downloadId,
    variantId,
    videoSlug,
  })
  if (filename) params.set("filename", filename)
  return `${DOWNLOAD_PROXY_PATH}?${params.toString()}`
}

export function buildDownloadFilename(
  videoTitle: string | null | undefined,
  tier: DownloadTier,
): string {
  const slug = (videoTitle ?? "video")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
  return `${slug || "video"}-${tier}.mp4`
}
