// Metadata service — extracts topics, speakers, and tags from transcript text.

import { z } from "zod"
import {
  DEFAULT_MODEL,
  createStructuredOpenrouterOutput,
} from "@/services/openrouter"
import { writeArtifact } from "@/services/storage"

export type VideoMetadata = {
  title: string
  description: string
  topics: string[]
  speakers: string[]
  tags: string[]
  language: string
}

export type MetadataResult = VideoMetadata & {
  artifactKeys: string[]
}

export type MetadataTone = "neutral" | "playful" | "professional"

export type MetadataPromptSectionKey =
  | "task"
  | "title"
  | "description"
  | "tags"
  | "qualityGuidelines"
  | "tone"
  | "language"

export type MetadataGenerationOptions = {
  tone?: MetadataTone
  outputLanguage?: string
  promptOverrides?: Partial<Record<MetadataPromptSectionKey, string>>
}

type RawMetadata = {
  title: string
  description: string
  topics: string[]
  speakers: string[]
  tags: string[]
  language: string
}

type PromptSection = {
  tag: string
  content: string
}

type ValidationResult =
  | {
      ok: true
      metadata: VideoMetadata
    }
  | {
      ok: false
      issues: string[]
    }

const metadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  topics: z.array(z.string()),
  speakers: z.array(z.string()),
  tags: z.array(z.string()),
  language: z.string(),
})

const metadataJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    speakers: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    language: { type: "string" },
  },
  required: ["title", "description", "topics", "speakers", "tags", "language"],
} satisfies Record<string, unknown>

const MAX_METADATA_ATTEMPTS = 2
const TITLE_WORD_LIMIT = 10
const DESCRIPTION_CHARACTER_LIMIT = 1000
const MAX_TAG_COUNT = 10

const METADATA_FILLER_PHRASES = [
  "the video shows",
  "this video shows",
  "this video features",
  "in this video",
  "the footage shows",
  "the clip shows",
  "the scene shows",
  "we can see",
  "you can see",
]

const TITLE_FILLER_PREFIXES = [
  "a video of",
  "video of",
  "the video shows",
  "this video shows",
  "this is a video",
]

const TONE_GUIDANCE: Record<MetadataTone, string> = {
  neutral: "Keep the writing clear, factual, and direct.",
  playful: "Keep the writing vivid and engaging without becoming casual slang.",
  professional: "Keep the writing polished, concise, and editorial.",
}

export class MetadataGenerationError extends Error {
  constructor(
    message: string,
    readonly code: "json_parse" | "schema_validation" | "quality_validation",
    readonly issues: string[],
  ) {
    super(message)
    this.name = "MetadataGenerationError"
  }
}

function formatMetadataFailureMessage(
  code: MetadataGenerationError["code"],
  issues: string[],
): string {
  if (issues.length === 0) {
    return `Metadata extraction produced no usable fields (${code})`
  }

  return `Metadata extraction produced no usable fields (${code}: ${issues.join("; ")})`
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function renderPromptSection({ tag, content }: PromptSection): string {
  const trimmed = content.trim()
  if (!trimmed) return ""
  return `<${tag}>\n${escapeXmlText(trimmed)}\n</${tag}>`
}

function createPromptSections(
  transcript: string,
  options: MetadataGenerationOptions,
): PromptSection[] {
  const tone = options.tone ?? "neutral"
  const outputLanguage = options.outputLanguage?.trim()
  const overrides = options.promptOverrides ?? {}

  const sections: Array<PromptSection | null> = [
    {
      tag: "task",
      content:
        overrides.task ??
        `Analyze the transcript and return JSON with title, description, topics, speakers, tags, and language.`,
    },
    {
      tag: "title_requirements",
      content:
        overrides.title ??
        `Write a concise, label-style title. Never exceed ${TITLE_WORD_LIMIT} words. Do not begin with phrases like "a video of" or "the video shows".`,
    },
    {
      tag: "description_requirements",
      content:
        overrides.description ??
        `Write a direct description under ${DESCRIPTION_CHARACTER_LIMIT} characters. Describe the content itself, not the medium. Do not use phrases like "the video shows" or "this video features".`,
    },
    {
      tag: "keywords_requirements",
      content:
        overrides.tags ??
        `Return up to ${MAX_TAG_COUNT} specific, searchable tags. Use lowercase. Avoid generic terms like "video" or "content".`,
    },
    {
      tag: "quality_guidelines",
      content:
        overrides.qualityGuidelines ??
        `Use only information grounded in the transcript. Prefer concrete topics, named speakers when clearly stated, and specific tags. Return valid JSON only.`,
    },
    {
      tag: "tone_guidance",
      content: overrides.tone ?? TONE_GUIDANCE[tone],
    },
    outputLanguage
      ? {
          tag: "language_guidance",
          content:
            overrides.language ??
            `Write the title and description in ${outputLanguage}. Set the language field to "${outputLanguage}".`,
        }
      : null,
    {
      tag: "transcript",
      content: transcript,
    },
  ]

  return sections.filter(
    (section): section is PromptSection => section !== null,
  )
}

function buildMetadataPrompt(
  transcript: string,
  options: MetadataGenerationOptions = {},
  retryIssues: string[] = [],
): string {
  const sections = createPromptSections(transcript, options)
  const rendered = sections.map(renderPromptSection).filter(Boolean)

  if (retryIssues.length > 0) {
    rendered.push(
      renderPromptSection({
        tag: "retry_corrections",
        content: `The previous response was invalid. Fix these issues:\n- ${retryIssues.join(
          "\n- ",
        )}\nReturn valid JSON only.`,
      }),
    )
  }

  return rendered.join("\n\n")
}

function countWords(value: string): number {
  const trimmed = value.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function normalizeStringList(
  values: string[],
  options?: { lowercase?: boolean; limit?: number },
): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue

    const dedupeKey = trimmed.toLowerCase()
    if (seen.has(dedupeKey)) continue

    seen.add(dedupeKey)
    normalized.push(options?.lowercase ? dedupeKey : trimmed)

    if (options?.limit && normalized.length >= options.limit) {
      break
    }
  }

  return normalized
}

function normalizeMetadata(
  rawMetadata: RawMetadata,
  language: string,
): VideoMetadata {
  return {
    title: rawMetadata.title.trim(),
    description: rawMetadata.description.trim(),
    topics: normalizeStringList(rawMetadata.topics),
    speakers: normalizeStringList(rawMetadata.speakers),
    tags: normalizeStringList(rawMetadata.tags, {
      lowercase: true,
      limit: MAX_TAG_COUNT,
    }),
    language,
  }
}

function containsFillerPhrase(value: string): boolean {
  const lower = value.toLowerCase()
  return METADATA_FILLER_PHRASES.some((phrase) => lower.includes(phrase))
}

function startsWithTitleFiller(value: string): boolean {
  const lower = value.toLowerCase().trim()
  return TITLE_FILLER_PREFIXES.some((phrase) => lower.startsWith(phrase))
}

function validateMetadataQuality(metadata: VideoMetadata): ValidationResult {
  const issues: string[] = []

  if (!metadata.title) {
    issues.push("Title must be non-empty.")
  } else {
    if (countWords(metadata.title) > TITLE_WORD_LIMIT) {
      issues.push(`Title must be at most ${TITLE_WORD_LIMIT} words.`)
    }
    if (
      startsWithTitleFiller(metadata.title) ||
      containsFillerPhrase(metadata.title)
    ) {
      issues.push("Title must avoid medium-referential filler phrasing.")
    }
  }

  if (!metadata.description) {
    issues.push("Description must be non-empty.")
  } else {
    if (metadata.description.length > DESCRIPTION_CHARACTER_LIMIT) {
      issues.push(
        `Description must be at most ${DESCRIPTION_CHARACTER_LIMIT} characters.`,
      )
    }
    if (containsFillerPhrase(metadata.description)) {
      issues.push("Description must avoid medium-referential filler phrasing.")
    }
  }

  if (metadata.tags.length === 0) {
    issues.push("At least one usable tag is required.")
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    }
  }

  return {
    ok: true,
    metadata,
  }
}

function mapStructuredOutputError(
  error: unknown,
): MetadataGenerationError | null {
  if (!(error instanceof Error)) return null

  if (error.message.includes("Structured output parsing failed")) {
    return new MetadataGenerationError(
      "Metadata extraction produced invalid structured output",
      "json_parse",
      ["Response was not valid JSON."],
    )
  }

  if (error.message.includes("Structured output validation failed")) {
    return new MetadataGenerationError(
      "Metadata extraction produced invalid structured output",
      "schema_validation",
      ["Response did not match the metadata schema."],
    )
  }

  if (error.message.includes("Structured output missing content")) {
    return new MetadataGenerationError(
      "Metadata extraction produced invalid structured output",
      "json_parse",
      ["Response was empty."],
    )
  }

  if (error.message.includes("Structured output request refused")) {
    return new MetadataGenerationError(
      "Metadata extraction produced invalid structured output",
      "quality_validation",
      ["Model refused to produce metadata."],
    )
  }

  return null
}

async function requestMetadataCandidate(prompt: string): Promise<RawMetadata> {
  try {
    return await createStructuredOpenrouterOutput({
      context: "metadata",
      name: "video_metadata",
      schema: metadataSchema,
      jsonSchema: metadataJsonSchema,
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a content analysis expert. Return a valid JSON object only with keys title, description, topics, speakers, tags, and language.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    })
  } catch (error) {
    throw mapStructuredOutputError(error) ?? error
  }
}

async function generateMetadataCandidate(
  transcript: string,
  language: string,
  options: MetadataGenerationOptions,
  retryIssues: string[] = [],
): Promise<VideoMetadata> {
  const prompt = buildMetadataPrompt(transcript, options, retryIssues)
  const rawMetadata = await requestMetadataCandidate(prompt)
  const normalized = normalizeMetadata(rawMetadata, language)
  const validation = validateMetadataQuality(normalized)

  if (!validation.ok) {
    throw new MetadataGenerationError(
      "Metadata extraction produced invalid quality output",
      "quality_validation",
      validation.issues,
    )
  }

  return validation.metadata
}

export async function extractMetadata(
  assetId: string,
  transcript: string,
  language: string,
  options: MetadataGenerationOptions = {},
): Promise<MetadataResult> {
  const resolvedOutputLanguage = options.outputLanguage?.trim() || language
  let lastError: MetadataGenerationError | undefined

  for (let attempt = 1; attempt <= MAX_METADATA_ATTEMPTS; attempt += 1) {
    try {
      const metadata = await generateMetadataCandidate(
        transcript,
        resolvedOutputLanguage,
        options,
        lastError?.issues ?? [],
      )

      await writeArtifact({
        assetId,
        artifactType: "metadata",
        ext: "json",
        body: JSON.stringify(metadata, null, 2),
        contentType: "application/json",
      })

      return {
        ...metadata,
        artifactKeys: ["metadata"],
      }
    } catch (error) {
      if (!(error instanceof MetadataGenerationError)) {
        throw error
      }

      lastError = error
      if (attempt === MAX_METADATA_ATTEMPTS) {
        throw new MetadataGenerationError(
          formatMetadataFailureMessage(error.code, error.issues),
          error.code,
          error.issues,
        )
      }
    }
  }

  throw new MetadataGenerationError(
    formatMetadataFailureMessage(
      lastError?.code ?? "quality_validation",
      lastError?.issues ?? ["Metadata extraction failed unexpectedly."],
    ),
    lastError?.code ?? "quality_validation",
    lastError?.issues ?? ["Metadata extraction failed unexpectedly."],
  )
}
