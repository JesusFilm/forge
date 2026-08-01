import type { DownloadTier } from "@/components/watch/download-options"

// Same-origin download resolver. Hardcoded against `next.config.mjs`'s
// `basePath: "/watch"`; if the basePath ever moves, this string moves with it.
// Successful media downloads redirect to the CDN so Web does not proxy bytes.
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

export function buildMediaProxyUrl(url: string): string {
  const params = new URLSearchParams({ url, disposition: "inline" })
  return `${DOWNLOAD_PROXY_PATH}?${params.toString()}`
}

export type BuildDownloadFilenameParams = {
  languageCode?: string | null
  languageName?: string | null
  languageSlug?: string | null
  renditionHeight?: number | null
  tier?: DownloadTier | null
  videoSlug?: string | null
  videoTitle?: string | null
}

const DOWNLOAD_FILENAME_EXTENSION = ".mp4"
const MAX_DOWNLOAD_FILENAME_LENGTH = 200

function asciiWords(value: string | null | undefined): string[] {
  return (
    (value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[A-Za-z0-9]+/g) ?? []
  )
}

function textSegment(
  value: string | null | undefined,
  fallback: string,
): string {
  const words = asciiWords(value)
  if (words.length > 0) return words.join("-")
  return asciiWords(fallback).join("-") || "Unknown"
}

function hasAsciiLetter(words: string[]): boolean {
  return words.some((word) => /[A-Za-z]/.test(word))
}

function textSegmentFrom(
  candidates: (string | null | undefined)[],
  fallback: string,
  options: { requireAsciiLetter?: boolean } = {},
): string {
  for (const candidate of candidates) {
    const words = asciiWords(candidate)
    if (
      words.length > 0 &&
      (!options.requireAsciiLetter || hasAsciiLetter(words))
    ) {
      return words.join("-")
    }
  }
  return asciiWords(fallback).join("-") || "Unknown"
}

function codeSegment(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const segment = asciiWords(candidate).join("-").toLowerCase()
    if (segment) return segment
  }
  return "unknown"
}

function renditionSegment(
  height: number | null | undefined,
  tier: DownloadTier | null | undefined,
): string {
  if (height != null && Number.isFinite(height) && height > 0) {
    return `${Math.round(height)}p`
  }
  return codeSegment(tier, "unknown")
}

export function buildDownloadFilename({
  languageCode,
  languageName,
  languageSlug,
  renditionHeight,
  tier,
  videoSlug,
  videoTitle,
}: BuildDownloadFilenameParams): string {
  const segments = [
    textSegmentFrom([videoTitle, videoSlug], "Video", {
      requireAsciiLetter: true,
    }),
    textSegment(languageName, "Language"),
    codeSegment(languageCode, languageSlug, languageName),
    renditionSegment(renditionHeight, tier),
  ]
  const maxBasenameLength =
    MAX_DOWNLOAD_FILENAME_LENGTH - DOWNLOAD_FILENAME_EXTENSION.length
  const basename =
    segments
      .join("_")
      .slice(0, maxBasenameLength)
      .replace(/[._-]+$/g, "") || "video"
  return `${basename}${DOWNLOAD_FILENAME_EXTENSION}`
}
