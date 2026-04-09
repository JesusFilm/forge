// Chapters service — automatic chapter segmentation from transcript.

import { z } from "zod"
import {
  DEFAULT_MODEL,
  createStructuredOpenrouterOutput,
} from "@/services/openrouter"
import { writeArtifact } from "@/services/storage"
import type { TranscriptSegment } from "@/services/transcription"

export type Chapter = {
  title: string
  startSeconds: number
  endSeconds: number | null
  summary: string
}

export type ChaptersResult = {
  chapters: Chapter[]
  artifactKeys: string[]
}

export type GenerateChaptersInput = {
  transcriptText: string
  segments?: TranscriptSegment[]
  language?: string
}

const MIN_CHAPTERS_PER_HOUR = 3
const MAX_CHAPTERS_PER_HOUR = 8
const GENERIC_CHAPTER_TITLE_PATTERN = /^(chapter|section|part)\s+\d+\s*$/i

const rawGeneratedChaptersSchema = z.object({
  chapters: z.array(
    z.object({
      title: z.string(),
      startSeconds: z.number(),
      summary: z.string(),
    }),
  ),
})

const rawGeneratedChaptersJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          startSeconds: { type: "number" },
          summary: { type: "string" },
        },
        required: ["title", "startSeconds", "summary"],
      },
    },
  },
  required: ["chapters"],
} satisfies Record<string, unknown>

type RawGeneratedChapters = z.infer<typeof rawGeneratedChaptersSchema>
type RawGeneratedChapter = RawGeneratedChapters["chapters"][number]

type NormalizedChapterCandidate = {
  title: string
  startSeconds: number
  summary: string
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function hasFiniteNonNegativeNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function getLastTranscriptSecond(
  segments?: TranscriptSegment[],
): number | null {
  if (!segments?.length) {
    return null
  }

  let lastSecond = -1

  for (const segment of segments) {
    if (Number.isFinite(segment.end) && segment.end > lastSecond) {
      lastSecond = segment.end
    }
  }

  return lastSecond >= 0 ? lastSecond : null
}

function getExpectedChapterCountRange(durationSeconds: number): {
  minimum: number
  maximum: number
} {
  const hours = durationSeconds / 3600

  return {
    minimum: Math.max(1, Math.floor(hours * MIN_CHAPTERS_PER_HOUR)),
    maximum: Math.max(3, Math.ceil(hours * MAX_CHAPTERS_PER_HOUR)),
  }
}

function buildDensityGuidance(durationSeconds: number | null): string[] {
  const guidance = [
    `- Aim for roughly ${MIN_CHAPTERS_PER_HOUR} to ${MAX_CHAPTERS_PER_HOUR} chapters per hour of content`,
    "- Use fewer chapters for short videos when extra splits would feel forced",
  ]

  if (!durationSeconds || durationSeconds <= 0) {
    return guidance
  }

  const { minimum, maximum } = getExpectedChapterCountRange(durationSeconds)

  guidance.push(
    `- For this transcript, a reasonable target range is about ${minimum} to ${maximum} chapters`,
  )

  return guidance
}

function logNormalizationEvent(
  assetId: string,
  data: {
    rawCount: number
    normalizedCount: number
    droppedInvalidRows: number
    droppedDuplicateRows: number
    droppedGenericTitleRows: number
  },
): void {
  const {
    droppedDuplicateRows,
    droppedGenericTitleRows,
    droppedInvalidRows,
    normalizedCount,
    rawCount,
  } = data

  if (
    droppedInvalidRows === 0 &&
    droppedDuplicateRows === 0 &&
    droppedGenericTitleRows === 0
  ) {
    return
  }

  console.log(
    JSON.stringify({
      event: "chapters_normalization_applied",
      assetId,
      rawCount,
      normalizedCount,
      droppedInvalidRows,
      droppedDuplicateRows,
      droppedGenericTitleRows,
    }),
  )
}

function logDensityGuidanceViolation(
  assetId: string,
  chapterCount: number,
  durationSeconds: number | null,
): void {
  if (!durationSeconds || durationSeconds <= 0) {
    return
  }

  const { minimum, maximum } = getExpectedChapterCountRange(durationSeconds)

  if (chapterCount >= minimum && chapterCount <= maximum) {
    return
  }

  console.log(
    JSON.stringify({
      event: "chapters_density_guidance_out_of_range",
      assetId,
      chapterCount,
      durationSeconds,
      minimumExpectedChapters: minimum,
      maximumExpectedChapters: maximum,
    }),
  )
}

function toNormalizedChapterCandidate(
  chapter: RawGeneratedChapter,
): NormalizedChapterCandidate | null {
  const title = normalizeText(chapter.title)
  const summary = normalizeText(chapter.summary)

  if (
    !title ||
    !summary ||
    !hasFiniteNonNegativeNumber(chapter.startSeconds) ||
    GENERIC_CHAPTER_TITLE_PATTERN.test(title)
  ) {
    return null
  }

  return {
    title,
    startSeconds: chapter.startSeconds,
    summary,
  }
}

export function buildTimestampedTranscript(
  segments?: TranscriptSegment[],
): string {
  if (!segments?.length) {
    return ""
  }

  return segments
    .map((segment) => {
      const text = normalizeText(segment.text)
      if (!text || !hasFiniteNonNegativeNumber(segment.start)) {
        return null
      }

      return `[${Math.floor(segment.start)}s] ${text}`
    })
    .filter((line): line is string => line !== null)
    .join("\n")
}

export function buildChapterPrompt(input: GenerateChaptersInput): string {
  const timestampedTranscript = buildTimestampedTranscript(input.segments)
  const transcriptBody =
    timestampedTranscript || normalizeText(input.transcriptText)

  if (!transcriptBody) {
    throw new Error("Chapter extraction requires transcript content")
  }

  const durationSeconds = getLastTranscriptSecond(input.segments)

  const sections = [
    [
      "TASK",
      "Segment the transcript into logical chapters and provide concise titles plus short summaries for each chapter.",
    ].join("\n"),
    [
      "OUTPUT FORMAT",
      'Return valid JSON in this exact shape: {"chapters":[{"title":"Introduction","startSeconds":0,"summary":"Opening context"}]}',
    ].join("\n"),
    [
      "TIMESTAMP GUIDANCE",
      "- When transcript lines include timestamps like [12s], use those timestamps as chapter anchors",
      "- Start times must be in seconds",
      "- The first chapter should begin at 0 seconds",
      "- Chapter start times must be non-decreasing",
    ].join("\n"),
    ["CHAPTER DENSITY GUIDANCE", ...buildDensityGuidance(durationSeconds)].join(
      "\n",
    ),
    [
      "TITLE GUIDANCE",
      "- Keep titles concise and descriptive",
      '- Avoid generic labels like "Chapter 1"',
      "- Reuse the transcript's own terminology when possible",
    ].join("\n"),
    [
      "SUMMARY GUIDANCE",
      "- Keep summaries short and factual",
      "- Summaries should describe the chapter's actual content",
    ].join("\n"),
  ]

  if (input.language && input.language !== "auto") {
    sections.push(
      [
        "LANGUAGE GUIDANCE",
        `Write chapter titles and summaries in the transcript language (${input.language}).`,
      ].join("\n"),
    )
  }

  sections.push(["TRANSCRIPT", transcriptBody].join("\n"))

  return sections.join("\n\n")
}

export function normalizeGeneratedChapters(
  rawChapters: RawGeneratedChapter[],
  options: {
    assetId: string
    segments?: TranscriptSegment[]
  },
): Chapter[] {
  let droppedInvalidRows = 0
  let droppedGenericTitleRows = 0
  const lastTranscriptSecond = getLastTranscriptSecond(options.segments)

  const sortedCandidates = rawChapters
    .map((chapter) => {
      const candidate = toNormalizedChapterCandidate(chapter)
      if (candidate) {
        return candidate
      }

      if (GENERIC_CHAPTER_TITLE_PATTERN.test(normalizeText(chapter.title))) {
        droppedGenericTitleRows += 1
      } else {
        droppedInvalidRows += 1
      }

      return null
    })
    .filter(
      (chapter): chapter is NormalizedChapterCandidate => chapter !== null,
    )
    .sort((left, right) => left.startSeconds - right.startSeconds)

  if (sortedCandidates.length === 0) {
    logNormalizationEvent(options.assetId, {
      rawCount: rawChapters.length,
      normalizedCount: 0,
      droppedInvalidRows,
      droppedDuplicateRows: 0,
      droppedGenericTitleRows,
    })
    return []
  }

  const anchoredCandidates = sortedCandidates.map((chapter, index) =>
    index === 0 ? { ...chapter, startSeconds: 0 } : chapter,
  )
  const boundedCandidates = anchoredCandidates.filter((chapter, index) => {
    if (lastTranscriptSecond === null || index === 0) {
      return true
    }

    if (chapter.startSeconds >= lastTranscriptSecond) {
      droppedInvalidRows += 1
      return false
    }

    return true
  })

  const dedupedCandidates: NormalizedChapterCandidate[] = []
  let droppedDuplicateRows = 0

  for (const chapter of boundedCandidates) {
    const previousChapter = dedupedCandidates[dedupedCandidates.length - 1]
    if (previousChapter?.startSeconds === chapter.startSeconds) {
      droppedDuplicateRows += 1
      continue
    }

    dedupedCandidates.push(chapter)
  }

  const chapters = dedupedCandidates.map((chapter, index) => {
    const nextChapter = dedupedCandidates[index + 1]
    const endSeconds = nextChapter
      ? lastTranscriptSecond === null
        ? nextChapter.startSeconds
        : Math.min(nextChapter.startSeconds, lastTranscriptSecond)
      : lastTranscriptSecond !== null &&
          lastTranscriptSecond > chapter.startSeconds
        ? lastTranscriptSecond
        : null

    return {
      title: chapter.title,
      startSeconds: chapter.startSeconds,
      endSeconds,
      summary: chapter.summary,
    }
  })

  logNormalizationEvent(options.assetId, {
    rawCount: rawChapters.length,
    normalizedCount: chapters.length,
    droppedInvalidRows,
    droppedDuplicateRows,
    droppedGenericTitleRows,
  })
  logDensityGuidanceViolation(
    options.assetId,
    chapters.length,
    lastTranscriptSecond,
  )

  return chapters
}

function assertUsableChapterOutline(chapters: Chapter[]) {
  if (chapters.length === 0) {
    throw new Error("Chapter extraction produced no chapters")
  }
}

export async function generateChapters(
  assetId: string,
  input: GenerateChaptersInput,
): Promise<ChaptersResult> {
  const parsed = await createStructuredOpenrouterOutput({
    context: "chapters",
    name: "chapters_outline",
    schema: rawGeneratedChaptersSchema,
    jsonSchema: rawGeneratedChaptersJsonSchema,
    model: DEFAULT_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a video content analyst. Identify logical chapter breaks from the supplied transcript.
Return valid JSON only.`,
      },
      { role: "user", content: buildChapterPrompt(input) },
    ],
  })

  const chapters = normalizeGeneratedChapters(parsed.chapters, {
    assetId,
    segments: input.segments,
  })
  assertUsableChapterOutline(chapters)

  await writeArtifact({
    assetId,
    artifactType: "chapters",
    ext: "json",
    body: JSON.stringify({ chapters }, null, 2),
    contentType: "application/json",
  })

  return {
    chapters,
    artifactKeys: ["chapters"],
  }
}
