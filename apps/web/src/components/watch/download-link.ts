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
  sequence?: DownloadSequence | null
  tier?: DownloadTier | null
  videoSlug?: string | null
  videoTitle?: string | null
}

export type DownloadSequence = {
  position: number
  total: number
}

export type DownloadSequenceParent = {
  children: readonly {
    documentId: string
    order?: number | null
  }[]
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

function sequenceSegment(
  position: number | null | undefined,
  total: number | null | undefined,
): string | null {
  if (!Number.isInteger(position) || position == null || position <= 0) {
    return null
  }
  const totalWidth =
    Number.isInteger(total) && total != null && total > 0
      ? String(total).length
      : 0
  const width = Math.max(2, String(position).length, totalWidth)
  return String(position).padStart(width, "0")
}

export function resolveDownloadSequence(
  parent: DownloadSequenceParent | null | undefined,
  videoDocumentId: string,
): DownloadSequence | null {
  if (!parent) return null
  const child = parent.children.find(
    (child) => child.documentId === videoDocumentId,
  )
  const position = child?.order
  if (!Number.isInteger(position) || position == null || position <= 0) {
    return null
  }
  const total = parent.children.reduce((highestOrder, candidate) => {
    const order = candidate.order
    return Number.isInteger(order) && order != null && order > highestOrder
      ? order
      : highestOrder
  }, position)
  return { position, total }
}

export function buildDownloadFilename({
  languageCode,
  languageName,
  languageSlug,
  renditionHeight,
  sequence,
  tier,
  videoSlug,
  videoTitle,
}: BuildDownloadFilenameParams): string {
  const sequencePrefix = sequenceSegment(sequence?.position, sequence?.total)
  const title = textSegmentFrom([videoTitle, videoSlug], "Video", {
    requireAsciiLetter: true,
  })
  const language = textSegment(languageName, "Language")
  const segments = [
    ...(sequencePrefix ? [sequencePrefix] : []),
    title,
    language,
    codeSegment(languageCode, languageSlug, languageName),
    renditionSegment(renditionHeight, tier),
  ]
  const maxBasenameLength =
    MAX_DOWNLOAD_FILENAME_LENGTH - DOWNLOAD_FILENAME_EXTENSION.length
  let overflow = segments.join("_").length - maxBasenameLength

  // Keep the sequence and identity suffix intact. Titles and display-language
  // names are the descriptive fields, so trim those first when the filename
  // would exceed the filesystem-safe limit.
  for (const segmentIndex of [sequencePrefix ? 1 : 0, sequencePrefix ? 2 : 1]) {
    if (overflow <= 0) break
    const segment = segments[segmentIndex]!
    const removable = Math.min(overflow, Math.max(0, segment.length - 1))
    segments[segmentIndex] =
      segment.slice(0, segment.length - removable).replace(/[._-]+$/g, "") ||
      segment[0]!
    overflow -= segment.length - segments[segmentIndex]!.length
  }

  const basename =
    segments
      .join("_")
      .slice(0, maxBasenameLength)
      .replace(/[._-]+$/g, "") || "video"
  return `${basename}${DOWNLOAD_FILENAME_EXTENSION}`
}
