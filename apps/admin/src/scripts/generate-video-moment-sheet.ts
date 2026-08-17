// Generate a story-beat sheet for one video from its subtitle-derived
// transcript — the PRODUCER half of the beat-sheet contract
// (src/services/video-moment-sheet.ts). Mirrors generate-persona-variants.ts's
// shape: read → bounded LLM call → schema gate → artifact for HUMANS.
// This script NEVER writes the database; the reviewed sheet is loaded by
// apply-video-moment-sheet.ts after a person signs it (plan R4).
//
// Usage:
//   OPENROUTER_API_KEY=... pnpm --filter @forge/admin exec tsx \
//     src/scripts/generate-video-moment-sheet.ts \
//     --slug=jesus [--language=en] [--out-dir=.tmp/video-moment-sheets] \
//     [--model=anthropic/claude-sonnet-4.5] [--source=db|moments-api]
//
// Input sources:
//   db          — video_transcript_chunk rows (text + timecodes) via
//                 DATABASE_URL. The richest input; needs DB access.
//   moments-api — the PUBLIC Video.moments field on production admin
//                 (summary excerpts + timecodes). Bootstrap mode for
//                 operators without a production DATABASE_URL; the sheet
//                 records sourceTranscriptId: null in that case.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  BEAT_SHEET_VERSION,
  renderBeatSheetMarkdown,
  validateBeatSheet,
  type BeatSheet,
} from "@/services/video-moment-sheet"

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5"
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
const LLM_TIMEOUT_MS = 180_000
const PUBLIC_ADMIN_GRAPHQL_URL = "https://admin.jesusfilm.org/api/graphql"

type TranscriptSegment = {
  startSeconds: number | null
  endSeconds: number | null
  text: string
}

function parseArgs(argv: string[]) {
  const get = (name: string) =>
    argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.slice(name.length + 3)
      ?.trim()
  return {
    slug: get("slug"),
    language: get("language") ?? "en",
    outDir: get("out-dir") ?? ".tmp/video-moment-sheets",
    model: get("model") ?? DEFAULT_MODEL,
    source: get("source") ?? "db",
    help: argv.includes("--help"),
  }
}

function usage(): never {
  console.error(
    "usage: generate-video-moment-sheet --slug=<video-slug> [--language=en] [--out-dir=dir] [--model=id] [--source=db|moments-api]",
  )
  process.exit(2)
}

async function loadSegmentsFromDb(
  slug: string,
  language: string,
): Promise<{ segments: TranscriptSegment[]; transcriptId: string | null }> {
  const { prisma } = await import("@/db/client")
  try {
    const video = await prisma.video.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true },
    })
    if (video == null) throw new Error(`no video with slug "${slug}"`)
    const transcript = await prisma.videoTranscript.findFirst({
      where: { videoId: video.id, language },
      orderBy: { generatedAt: "desc" },
      select: { id: true },
    })
    if (transcript == null) {
      throw new Error(`no ${language} transcript for "${slug}"`)
    }
    const chunks = await prisma.videoTranscriptChunk.findMany({
      where: { transcriptId: transcript.id },
      orderBy: { chunkIndex: "asc" },
      select: { startSeconds: true, endSeconds: true, text: true },
    })
    return {
      segments: chunks.map((c) => ({
        startSeconds: c.startSeconds,
        endSeconds: c.endSeconds,
        text: c.text,
      })),
      transcriptId: transcript.id,
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function loadSegmentsFromMomentsApi(
  slug: string,
  language: string,
): Promise<{ segments: TranscriptSegment[]; transcriptId: string | null }> {
  const response = await fetch(PUBLIC_ADMIN_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      query: `query($slug: String!, $languageSlug: String) {
        videoBySlug(slug: $slug) {
          moments(languageSlug: $languageSlug, limit: 300) {
            startSeconds endSeconds summary
          }
        }
      }`,
      variables: { slug, languageSlug: language },
    }),
  })
  if (!response.ok) throw new Error(`moments-api HTTP ${response.status}`)
  const payload = (await response.json()) as {
    data?: {
      videoBySlug?: {
        moments?: Array<{
          startSeconds: number | null
          endSeconds: number | null
          summary: string | null
        }>
      } | null
    }
    errors?: Array<{ message: string }>
  }
  if (payload.errors?.length) throw new Error(payload.errors[0]!.message)
  const moments = payload.data?.videoBySlug?.moments ?? []
  const segments = moments
    .filter((m) => m.summary != null && m.summary.trim().length > 0)
    .map((m) => ({
      startSeconds: m.startSeconds,
      endSeconds: m.endSeconds,
      text: m.summary!,
    }))
  if (segments.length === 0) {
    throw new Error(`moments-api returned no usable segments for "${slug}"`)
  }
  return { segments, transcriptId: null }
}

function buildPrompt(
  slug: string,
  segments: TranscriptSegment[],
): { system: string; user: string } {
  const system = [
    "You turn a film transcript into a reviewed 'beat sheet' for a TV app's Explore panel.",
    "The film dramatizes a Gospel narrative. For EACH transcript segment, produce:",
    "1. summary: 1-2 sentences of third-person STORY narration (what happens on screen), never dialogue quotes, never 'in this scene'.",
    "2. bibleVerses: 1-2 references for the passage the segment depicts. STRICT format, one reference per array element:",
    "   'Book C', 'Book C:V' or 'Book C:V-V' — FULL canonical English book name (e.g. 'Luke', '1 Corinthians'),",
    "   same-chapter ranges only, plain hyphen, no abbreviations, no OSIS dots, no commas inside one reference, no prose.",
    "3. question: ONE reflective question in an accessible, warm voice (like 'How do the different groups of people respond to Jesus?'), or null where a question would feel forced.",
    "Keep each segment's startSeconds/endSeconds EXACTLY as given. Respond with ONLY a JSON array, one object per input segment, fields: startSeconds, endSeconds, summary, bibleVerses, question.",
  ].join("\n")
  const user = JSON.stringify(
    {
      film: slug,
      segments: segments.map((s) => ({
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds,
        text: s.text,
      })),
    },
    null,
    1,
  )
  return { system, user }
}

async function callLlm(
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const apiKey =
    process.env.OPENROUTER_API_PAID_KEY ?? process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error("OPENROUTER_API_PAID_KEY or OPENROUTER_API_KEY required")
  }
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
    }),
  })
  if (!response.ok) {
    throw new Error(`openrouter HTTP ${response.status}`)
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error("openrouter returned no content")
  return content
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON array in model output")
  }
  return JSON.parse(text.slice(start, end + 1))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.slug) usage()
  if (args.source !== "db" && args.source !== "moments-api") usage()

  console.log(
    JSON.stringify({
      event: "generate-video-moment-sheet.start",
      slug: args.slug,
      language: args.language,
      source: args.source,
      model: args.model,
    }),
  )

  const { segments, transcriptId } =
    args.source === "db"
      ? await loadSegmentsFromDb(args.slug, args.language)
      : await loadSegmentsFromMomentsApi(args.slug, args.language)

  console.log(
    JSON.stringify({
      event: "generate-video-moment-sheet.loaded",
      segments: segments.length,
      transcriptId,
    }),
  )

  const { system, user } = buildPrompt(args.slug, segments)
  const raw = await callLlm(args.model, system, user)
  const parsed = extractJsonArray(raw)
  if (!Array.isArray(parsed)) throw new Error("model output is not an array")

  const beats = parsed.map((item, index) => {
    const row = item as Record<string, unknown>
    return {
      beatIndex: index,
      startSeconds:
        typeof row.startSeconds === "number"
          ? row.startSeconds
          : (segments[index]?.startSeconds ?? index),
      endSeconds:
        typeof row.endSeconds === "number"
          ? row.endSeconds
          : (segments[index]?.endSeconds ?? null),
      summary: typeof row.summary === "string" ? row.summary.trim() : "",
      bibleVerses: Array.isArray(row.bibleVerses)
        ? row.bibleVerses.filter((v): v is string => typeof v === "string")
        : [],
      question:
        typeof row.question === "string" && row.question.trim().length > 0
          ? row.question.trim()
          : null,
    }
  })

  const sheet: BeatSheet = {
    version: BEAT_SHEET_VERSION,
    videoSlug: args.slug,
    languageSlug: args.language,
    sourceModel: args.model,
    sourceTranscriptId: transcriptId,
    reviewedBy: "",
    reviewedAt: null,
    beats,
  }

  // Generator posture: unsigned is expected; every other rule must hold.
  const validation = validateBeatSheet(sheet, { requireSigned: false })
  const referenceIssues = validation.ok
    ? []
    : validation.issues.filter((i) => i.kind === "reference")
  if (!validation.ok) {
    const blocking = validation.issues.filter((i) => i.kind !== "reference")
    if (blocking.length > 0) {
      console.error(
        JSON.stringify({
          event: "generate-video-moment-sheet.invalid",
          issues: blocking,
        }),
      )
      process.exit(1)
    }
  }

  mkdirSync(args.outDir, { recursive: true })
  const base = join(args.outDir, `${args.slug}.${args.language}.beat-sheet`)
  writeFileSync(`${base}.json`, JSON.stringify(sheet, null, 2))
  writeFileSync(`${base}.md`, renderBeatSheetMarkdown(sheet))

  console.log(
    JSON.stringify({
      event: "generate-video-moment-sheet.complete",
      beats: beats.length,
      // Reference issues are surfaced for the REVIEWER to fix in the JSON —
      // the loader will refuse the sheet until they are gone.
      referenceIssues,
      json: `${base}.json`,
      markdown: `${base}.md`,
      next: "review the .md, correct the .json, fill reviewedBy/reviewedAt, then run apply-video-moment-sheet",
    }),
  )
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "generate-video-moment-sheet.failed",
      message: error instanceof Error ? error.message : String(error),
    }),
  )
  process.exit(1)
})
