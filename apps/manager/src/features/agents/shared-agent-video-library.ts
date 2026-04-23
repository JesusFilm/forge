import {
  getSharedAgentDefinition,
  type SharedAgentDefinition,
} from "@forge/agents"
import { graphql } from "@forge/graphql"
import getClient from "@/cms/client"
import { resolveCmsLanguageCode } from "@/lib/mux-language"
import { fetchSubtitleText } from "@/services/subtitles"
import type {
  SharedAgentRunRequest,
  SharedAgentSubtitleContextStatus,
  SharedAgentVideoHydrationResponse,
  SharedAgentVideoItem,
} from "./shared-agent-contract"

const SEARCH_LIBRARY_VIDEOS = graphql(`
  query SearchSharedAgentLibraryVideos($query: String!) {
    videos(
      filters: {
        or: [{ title: { containsi: $query } }, { slug: { containsi: $query } }]
      }
      pagination: { pageSize: 12 }
      sort: ["title:asc"]
    ) {
      documentId
      coreId
      title
      slug
      description
      primaryLanguage {
        coreId
        name
        bcp47
        iso3
      }
    }
  }
`)

const GET_LIBRARY_VIDEO_SOURCE = graphql(`
  query GetSharedAgentLibraryVideoSource($documentId: ID!) {
    video(documentId: $documentId) {
      documentId
      coreId
      title
      slug
      description
      snippet
      imageAlt
      aiMetadata
      primaryLanguage {
        coreId
        name
        bcp47
        iso3
      }
      subtitles(pagination: { limit: -1 }, sort: ["primary:desc"]) {
        primary
        aiGenerated
        vttSrc
        language {
          coreId
          name
          bcp47
          iso3
        }
      }
    }
  }
`)

const MAX_TRANSCRIPT_CONTEXT_CHARS = 4_000
const MIN_LIBRARY_VIDEO_QUERY_LENGTH = 2
const TRANSCRIPT_CONTEXT_ROLE_TAG_PATTERN =
  /<\/?(?:system|developer|assistant|user|instructions?)>/gi
const TRANSCRIPT_CONTEXT_ZERO_WIDTH_PATTERN = /[\u200b-\u200d\uFEFF]/g
const TRANSCRIPT_CONTEXT_BLOCKED_LINE_PATTERNS = [
  /\bignore\b.{0,48}\b(?:instructions?|prompt|system|developer|assistant|rules?)\b/i,
  /\b(?:reveal|show|print|display|dump|output)\b.{0,48}\b(?:system prompt|developer message|internal instructions?|hidden prompt|tool call|function call|payload)\b/i,
  /\b(?:system prompt|developer message|internal instructions?|hidden prompt|tool call|function call)\b/i,
  /^\s*(?:system|developer|assistant|user)\s*[:>]\s*/i,
  /^\s*<\/?(?:system|developer|assistant|user|instructions?)>/i,
  /\byou are (?:chatgpt|gpt|an ai assistant|a helpful assistant|a language model)\b/i,
  /\b(?:begin|end)\s+(?:system|developer|prompt|instructions?)\b/i,
] as const

type SubtitleTrackSource = {
  primary?: boolean | null
  vttSrc?: string | null
  language?: {
    coreId?: string | null
    name?: string | null
    bcp47?: string | null
    iso3?: string | null
  } | null
}

type SharedAgentVideoSource = {
  video: SharedAgentVideoItem
  subtitleContextStatus: SharedAgentSubtitleContextStatus
  transcriptExcerpt?: string
  metadataArtifacts: {
    title: string
    description: string | null
    slug: string | null
    snippet: string | null
    imageAlt: string | null
    aiMetadata: boolean | null
  }
  sceneSignals: {
    available: boolean
    summary: string | null
  }
}

type SharedAgentVideoLibraryDeps = {
  fetchSubtitleText?: (url: string) => Promise<string>
  loadVideoByDocumentId?: (documentId: string) => Promise<{
    documentId: string
    coreId?: string | null
    title?: string | null
    slug?: string | null
    description?: string | null
    snippet?: string | null
    imageAlt?: string | null
    aiMetadata?: boolean | null
    primaryLanguage?: {
      coreId?: string | null
      name?: string | null
      bcp47?: string | null
      iso3?: string | null
    } | null
    subtitles?: Array<SubtitleTrackSource | null> | null
  } | null>
}

export class SharedAgentVideoNotFoundError extends Error {
  constructor(documentId: string) {
    super(`Library video "${documentId}" was not found.`)
    this.name = "SharedAgentVideoNotFoundError"
  }
}

function trimNonBlank(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toSharedAgentVideoItem(input: {
  documentId: string
  coreId?: string | null
  title?: string | null
  slug?: string | null
  description?: string | null
  primaryLanguage?: {
    name?: string | null
    coreId?: string | null
    bcp47?: string | null
    iso3?: string | null
  } | null
}): SharedAgentVideoItem {
  return {
    documentId: input.documentId,
    coreId: trimNonBlank(input.coreId) ?? null,
    title:
      trimNonBlank(input.title) ??
      trimNonBlank(input.slug) ??
      trimNonBlank(input.coreId) ??
      input.documentId,
    slug: trimNonBlank(input.slug) ?? null,
    description: trimNonBlank(input.description) ?? null,
    primaryLanguage:
      trimNonBlank(input.primaryLanguage?.name) ??
      resolveCmsLanguageCode(input.primaryLanguage) ??
      null,
  }
}

function shouldIncludeSubtitleContext(
  definition: SharedAgentDefinition,
): boolean {
  return (
    definition.id === "video_enhancing" ||
    definition.id === "seo" ||
    definition.id === "marketing"
  )
}

function truncateTranscriptContext(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= MAX_TRANSCRIPT_CONTEXT_CHARS) {
    return trimmed
  }

  return `${trimmed.slice(0, MAX_TRANSCRIPT_CONTEXT_CHARS).trimEnd()}...`
}

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      if (codePoint == null) {
        return false
      }

      if (codePoint === 0x7f) {
        return false
      }

      return !(codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a)
    })
    .join("")
}

function sanitizeTranscriptContext(value: string): string | null {
  const sanitizedLines = stripControlCharacters(value.replace(/\r\n?/g, "\n"))
    .replace(TRANSCRIPT_CONTEXT_ZERO_WIDTH_PATTERN, "")
    .split("\n")
    .map((line) =>
      line
        .replace(TRANSCRIPT_CONTEXT_ROLE_TAG_PATTERN, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter(
      (line) =>
        !TRANSCRIPT_CONTEXT_BLOCKED_LINE_PATTERNS.some((pattern) =>
          pattern.test(line),
        ),
    )

  if (sanitizedLines.length === 0) {
    return null
  }

  return truncateTranscriptContext(sanitizedLines.join("\n"))
}

function choosePreferredSubtitleTrack(
  tracks: Array<SubtitleTrackSource | null> | null | undefined,
  preferredLanguageCode: string | null,
): string | null {
  const candidates = (tracks ?? [])
    .filter((track): track is SubtitleTrackSource => track != null)
    .map((track) => ({
      src: trimNonBlank(track.vttSrc),
      primary: Boolean(track.primary),
      languageCode: resolveCmsLanguageCode(track.language),
    }))
    .filter(
      (
        track,
      ): track is {
        src: string
        primary: boolean
        languageCode: string | null
      } => track.src != null,
    )

  const primaryTrack = candidates.find((track) => track.primary)
  if (primaryTrack) {
    return primaryTrack.src
  }

  if (preferredLanguageCode) {
    const languageMatch = candidates.find(
      (track) => track.languageCode === preferredLanguageCode,
    )
    if (languageMatch) {
      return languageMatch.src
    }
  }

  return candidates[0]?.src ?? null
}

function buildMetadataBlock(video: SharedAgentVideoItem): string {
  const lines = [`Title: ${video.title}`]

  if (video.description) {
    lines.push(`Description: ${video.description}`)
  }

  if (video.slug) {
    lines.push(`Slug: ${video.slug}`)
  }

  return lines.join("\n")
}

function buildSupportingContext(video: SharedAgentVideoItem): string {
  const lines = [
    "Source: Forge library video.",
    `Video document ID: ${video.documentId}`,
  ]

  if (video.coreId) {
    lines.push(`Video core ID: ${video.coreId}`)
  }

  if (video.slug) {
    lines.push(`Video slug: ${video.slug}`)
  }

  if (video.primaryLanguage) {
    lines.push(`Primary language: ${video.primaryLanguage}`)
  }

  return lines.join("\n")
}

export function buildSharedAgentDraftFromVideo(input: {
  definition: SharedAgentDefinition
  source: SharedAgentVideoSource
}): SharedAgentRunRequest {
  const metadataBlock = buildMetadataBlock(input.source.video)
  const transcriptExcerpt = input.source.transcriptExcerpt
    ? sanitizeTranscriptContext(input.source.transcriptExcerpt)
    : null
  const transcriptBlock = transcriptExcerpt
    ? `Transcript excerpt:\n${transcriptExcerpt}`
    : null

  switch (input.definition.id) {
    case "translation":
      return {
        goal: "Translate this library video's metadata for the target language.",
        supportingContext: buildSupportingContext(input.source.video),
        fields: {
          source_text: metadataBlock,
          target_language: "",
          tone_notes: "",
        },
      }
    case "video_enhancing":
      return {
        goal: "Improve this library video's packaging and editorial presentation.",
        supportingContext: buildSupportingContext(input.source.video),
        fields: {
          video_context: [metadataBlock, transcriptBlock]
            .filter(Boolean)
            .join("\n\n"),
          distribution_surface: "",
          target_audience: "",
        },
      }
    case "seo":
      return {
        goal: "Improve this library video's metadata for SEO and discovery.",
        supportingContext: buildSupportingContext(input.source.video),
        fields: {
          source_copy: [metadataBlock, transcriptBlock]
            .filter(Boolean)
            .join("\n\n"),
          target_keyword: "",
          search_intent: "",
        },
      }
    case "marketing":
      return {
        goal: "Create launch-ready messaging for this library video.",
        supportingContext: buildSupportingContext(input.source.video),
        fields: {
          offer_or_content: [metadataBlock, transcriptBlock]
            .filter(Boolean)
            .join("\n\n"),
          audience: "",
          channel: "",
        },
      }
    default:
      return {
        goal: input.definition.starterPrompt,
        supportingContext: buildSupportingContext(input.source.video),
        fields: Object.fromEntries(
          input.definition.fields.map((field) => [field.key, ""]),
        ),
      }
  }
}

async function defaultLoadVideoByDocumentId(documentId: string) {
  const client = getClient()
  const result = await client.query({
    query: GET_LIBRARY_VIDEO_SOURCE,
    variables: { documentId },
    fetchPolicy: "no-cache",
  })

  return result.data?.video ?? null
}

export async function loadSharedAgentVideoSource(input: {
  definition: SharedAgentDefinition
  videoDocumentId: string
  deps?: SharedAgentVideoLibraryDeps
}): Promise<SharedAgentVideoSource> {
  const loadVideoByDocumentId =
    input.deps?.loadVideoByDocumentId ?? defaultLoadVideoByDocumentId
  const video = await loadVideoByDocumentId(input.videoDocumentId)

  if (!video) {
    throw new SharedAgentVideoNotFoundError(input.videoDocumentId)
  }

  const sharedVideo = toSharedAgentVideoItem(video)
  const metadataArtifacts = {
    title: sharedVideo.title,
    description: trimNonBlank(video.description) ?? null,
    slug: trimNonBlank(video.slug) ?? null,
    snippet: trimNonBlank(video.snippet) ?? null,
    imageAlt: trimNonBlank(video.imageAlt) ?? null,
    aiMetadata:
      typeof video.aiMetadata === "boolean" ? Boolean(video.aiMetadata) : null,
  }

  if (!shouldIncludeSubtitleContext(input.definition)) {
    return {
      video: sharedVideo,
      subtitleContextStatus: "omitted",
      metadataArtifacts,
      sceneSignals: {
        available: false,
        summary: null,
      },
    }
  }

  const subtitleSrc = choosePreferredSubtitleTrack(
    video.subtitles,
    resolveCmsLanguageCode(video.primaryLanguage),
  )
  if (!subtitleSrc) {
    return {
      video: sharedVideo,
      subtitleContextStatus: "unavailable",
      metadataArtifacts,
      sceneSignals: {
        available: false,
        summary: null,
      },
    }
  }

  const subtitleFetcher = input.deps?.fetchSubtitleText ?? fetchSubtitleText

  try {
    const transcript = await subtitleFetcher(subtitleSrc)
    const excerpt = trimNonBlank(transcript)
    if (!excerpt) {
      return {
        video: sharedVideo,
        subtitleContextStatus: "unavailable",
        metadataArtifacts,
        sceneSignals: {
          available: false,
          summary: null,
        },
      }
    }

    const sanitizedExcerpt = sanitizeTranscriptContext(excerpt)
    if (!sanitizedExcerpt) {
      return {
        video: sharedVideo,
        subtitleContextStatus: "unavailable",
        metadataArtifacts,
        sceneSignals: {
          available: false,
          summary: null,
        },
      }
    }

    return {
      video: sharedVideo,
      subtitleContextStatus: "included",
      transcriptExcerpt: sanitizedExcerpt,
      metadataArtifacts,
      sceneSignals: {
        available: false,
        summary: null,
      },
    }
  } catch (error) {
    console.warn(
      "[shared-agent-video-library] Failed to fetch subtitle context:",
      error,
    )

    return {
      video: sharedVideo,
      subtitleContextStatus: "unavailable",
      metadataArtifacts,
      sceneSignals: {
        available: false,
        summary: null,
      },
    }
  }
}

export async function searchSharedAgentLibraryVideos(
  query: string,
): Promise<SharedAgentVideoItem[]> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length < MIN_LIBRARY_VIDEO_QUERY_LENGTH) {
    return []
  }

  const client = getClient()
  const result = await client.query({
    query: SEARCH_LIBRARY_VIDEOS,
    variables: { query: trimmedQuery },
    fetchPolicy: "no-cache",
  })

  return (result.data?.videos ?? [])
    .filter((video): video is NonNullable<typeof video> => video != null)
    .map((video) => toSharedAgentVideoItem(video))
}

export async function hydrateSharedAgentVideoDraft(input: {
  agentId: string
  videoDocumentId: string
  deps?: SharedAgentVideoLibraryDeps
}): Promise<SharedAgentVideoHydrationResponse> {
  const definition = getSharedAgentDefinition(input.agentId)
  if (!definition) {
    throw new Error(`Shared agent "${input.agentId}" was not found.`)
  }

  const source = await loadSharedAgentVideoSource({
    definition,
    videoDocumentId: input.videoDocumentId,
    deps: input.deps,
  })

  return {
    video: source.video,
    subtitleContextStatus: source.subtitleContextStatus,
    draft: buildSharedAgentDraftFromVideo({ definition, source }),
  }
}
