import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"

const SUBTITLE_FETCH_TIMEOUT_MS = 15_000
const SUBTITLE_MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 3
const TRUSTED_SUBTITLE_HOSTS = ["jesusfilm.org", "stream.mux.com"] as const

export type TranscriptTimedTextFormat = "vtt" | "srt"

export type TranscriptSourceResolverTarget = {
  videoId: string
  videoEditionId: string
  coreId: string
  cmsVideoId: number
  language: string
  languageId?: string | null
  languageSlug?: string | null
  hasSubtitle?: boolean
  hasDub?: boolean
  isPrimaryLanguage?: boolean
}

export type TranscriptSourceSegment = {
  start: number
  end: number
  text: string
}

export type ResolvedTranscriptEmbeddingSource = {
  sourceKind: "subtitle" | "manager-transcript"
  transcript: {
    text: string
    segments: TranscriptSourceSegment[]
    artifactKey: string
    kind: "subtitle" | "manager-transcript"
    languageId?: string | null
    languageSlug?: string | null
    subtitleId?: string
    format?: TranscriptTimedTextFormat
    url?: string
    provider?: string
    generatedAt?: string
  }
  provenance: {
    sourceKind: "subtitle" | "manager-transcript"
    sourceKey: string
    contentHash?: string
    language: string
    languageId?: string | null
    languageSlug?: string | null
    subtitleId?: string
    format?: TranscriptTimedTextFormat
    url?: string
  }
}

export type TranscriptSourceGapReason =
  | "subtitle_missing"
  | "subtitle_without_timed_text"
  | "subtitle_fetch_failed"
  | "subtitle_empty"

export type TranscriptSourceGap = {
  reason: TranscriptSourceGapReason
  sourceKind: "subtitle"
  language: string
  languageId?: string | null
  languageSlug?: string | null
  subtitleId?: string
  format?: TranscriptTimedTextFormat
  url?: string
  detail?: string
}

export type SubtitleTranscriptSourceResolution =
  | { status: "resolved"; source: ResolvedTranscriptEmbeddingSource }
  | { status: "gap"; gap: TranscriptSourceGap }

export type ResolveSubtitleTranscriptSourceOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

class SubtitleFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SubtitleFetchError"
  }
}

function isTrustedSubtitleHost(hostname: string): boolean {
  return TRUSTED_SUBTITLE_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  )
}

function assertTrustedSubtitleUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== "https:" || !isTrustedSubtitleHost(url.hostname)) {
    throw new SubtitleFetchError(
      `untrusted subtitle URL hostname: ${url.hostname}`,
    )
  }
  return url
}

function safeUrlForStorage(value: string): string {
  const url = new URL(value)
  url.username = ""
  url.password = ""
  url.hash = ""
  return url.toString()
}

async function fetchTimedTextContent(
  sourceUrl: string,
  options: ResolveSubtitleTranscriptSourceOptions,
): Promise<string> {
  let currentUrl = assertTrustedSubtitleUrl(sourceUrl)
  const fetchImpl = options.fetchImpl ?? fetch

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response
    try {
      response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(
          options.timeoutMs ?? SUBTITLE_FETCH_TIMEOUT_MS,
        ),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new SubtitleFetchError(`failed to fetch subtitle: ${message}`)
    }

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location")
    ) {
      const location = response.headers.get("location")!
      currentUrl = assertTrustedSubtitleUrl(
        new URL(location, currentUrl).toString(),
      )
      continue
    }

    if (response.status >= 300 && response.status < 400) {
      throw new SubtitleFetchError("subtitle redirect missing location header")
    }

    if (!response.ok) {
      throw new SubtitleFetchError(
        `subtitle fetch failed with status ${response.status}`,
      )
    }

    const contentLength = response.headers.get("content-length")
    if (contentLength && Number(contentLength) > SUBTITLE_MAX_BYTES) {
      throw new SubtitleFetchError(
        `subtitle response too large: ${contentLength} bytes`,
      )
    }

    const content = await response.text()
    if (content.length > SUBTITLE_MAX_BYTES) {
      throw new SubtitleFetchError(
        `subtitle content too large: ${content.length} bytes`,
      )
    }

    return content
  }

  throw new SubtitleFetchError("subtitle redirect limit exceeded")
}

function parseTimestamp(value: string): number {
  const parts = value.trim().replace(",", ".").split(":")
  if (parts.length < 2 || parts.length > 3) return Number.NaN

  const seconds = Number.parseFloat(parts.pop() ?? "")
  const minutes = Number.parseInt(parts.pop() ?? "", 10)
  const hours = parts.length === 1 ? Number.parseInt(parts.pop() ?? "", 10) : 0

  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(hours)
  ) {
    return Number.NaN
  }

  return hours * 3600 + minutes * 60 + seconds
}

function cleanCueText(value: string): string {
  let cleaned = value.trim()
  let previous = ""
  while (cleaned !== previous) {
    previous = cleaned
    cleaned = cleaned.replace(/<[^>]+>/g, "")
  }
  return cleaned
    .replace(/\{\\[^}]+}/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function parseTimedText(
  content: string,
  format: TranscriptTimedTextFormat,
): TranscriptSourceSegment[] {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const segments: TranscriptSourceSegment[] = []
  let index = 0
  let skippingBlock = false

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? ""

    if (format === "vtt" && /^(NOTE|STYLE|REGION)\b/.test(line)) {
      skippingBlock = true
      index += 1
      continue
    }
    if (skippingBlock) {
      if (!line) skippingBlock = false
      index += 1
      continue
    }

    if (!line || line === "WEBVTT" || /^\d+$/.test(line)) {
      index += 1
      continue
    }

    if (!line.includes("-->")) {
      index += 1
      continue
    }

    const [rawStart, rawEnd] = line.split("-->", 2)
    const start = parseTimestamp(rawStart ?? "")
    const end = parseTimestamp((rawEnd ?? "").trim().split(/\s+/)[0] ?? "")
    index += 1

    const textLines: string[] = []
    while (index < lines.length) {
      const cueLine = lines[index]?.trim() ?? ""
      if (!cueLine) break
      textLines.push(cueLine)
      index += 1
    }

    const text = cleanCueText(textLines.join(" "))
    if (
      text &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end >= start
    ) {
      segments.push({ start, end, text })
    }
  }

  return segments
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`
}

function gap(
  target: TranscriptSourceResolverTarget,
  reason: TranscriptSourceGapReason,
  details: Partial<TranscriptSourceGap> = {},
): SubtitleTranscriptSourceResolution {
  return {
    status: "gap",
    gap: {
      reason,
      sourceKind: "subtitle",
      language: target.language,
      languageId: target.languageId,
      languageSlug: target.languageSlug,
      ...details,
    },
  }
}

function selectTimedTextSource(subtitle: {
  vttSrc: string | null
  srtSrc: string | null
}): { format: TranscriptTimedTextFormat; url: string } | null {
  const vttSrc = subtitle.vttSrc?.trim()
  if (vttSrc) return { format: "vtt", url: vttSrc }

  const srtSrc = subtitle.srtSrc?.trim()
  if (srtSrc) return { format: "srt", url: srtSrc }

  return null
}

export async function resolveSubtitleTranscriptSource(
  prisma: PrismaClient,
  target: TranscriptSourceResolverTarget,
  options: ResolveSubtitleTranscriptSourceOptions = {},
): Promise<SubtitleTranscriptSourceResolution> {
  const languageFilter = target.languageId
    ? { languageId: target.languageId }
    : { language: { bcp47: target.language, deletedAt: null } }

  const subtitles = await prisma.videoSubtitle.findMany({
    where: {
      videoEditionId: target.videoEditionId,
      deletedAt: null,
      ...languageFilter,
    },
    orderBy: [{ primary: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      languageId: true,
      primary: true,
      vttSrc: true,
      srtSrc: true,
      syncedAt: true,
      updatedAt: true,
      language: {
        select: {
          bcp47: true,
          slug: true,
        },
      },
    },
  })

  if (subtitles.length === 0) {
    return gap(target, "subtitle_missing")
  }

  for (const subtitle of subtitles) {
    const selected = selectTimedTextSource(subtitle)
    if (!selected) continue

    let content: string
    try {
      content = await fetchTimedTextContent(selected.url, options)
    } catch (error) {
      return gap(target, "subtitle_fetch_failed", {
        subtitleId: subtitle.id,
        format: selected.format,
        url: safeUrlForStorage(selected.url),
        detail: error instanceof Error ? error.message : String(error),
      })
    }

    const segments = parseTimedText(content, selected.format)
    const text = segments
      .map((segment) => segment.text)
      .join(" ")
      .trim()

    if (!text || segments.length === 0) {
      return gap(target, "subtitle_empty", {
        subtitleId: subtitle.id,
        format: selected.format,
        url: safeUrlForStorage(selected.url),
      })
    }

    const sourceKey = `admin-video-subtitle/${subtitle.id}.${selected.format}`
    const generatedAt =
      subtitle.syncedAt?.toISOString() ?? subtitle.updatedAt.toISOString()

    return {
      status: "resolved",
      source: {
        sourceKind: "subtitle",
        transcript: {
          text,
          segments,
          artifactKey: sourceKey,
          kind: "subtitle",
          languageId: subtitle.languageId ?? target.languageId,
          languageSlug: subtitle.language?.slug ?? target.languageSlug,
          subtitleId: subtitle.id,
          format: selected.format,
          url: safeUrlForStorage(selected.url),
          provider: "admin-subtitle",
          generatedAt,
        },
        provenance: {
          sourceKind: "subtitle",
          sourceKey,
          contentHash: sha256Json({
            sourceKind: "subtitle",
            subtitleId: subtitle.id,
            format: selected.format,
            text,
            segments,
          }),
          language: subtitle.language?.bcp47 ?? target.language,
          languageId: subtitle.languageId ?? target.languageId,
          languageSlug: subtitle.language?.slug ?? target.languageSlug,
          subtitleId: subtitle.id,
          format: selected.format,
          url: safeUrlForStorage(selected.url),
        },
      },
    }
  }

  return gap(target, "subtitle_without_timed_text")
}

export const _internals = {
  fetchTimedTextContent,
  parseTimedText,
}
