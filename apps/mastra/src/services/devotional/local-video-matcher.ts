import { z } from "zod"

import { getDevotionalModel } from "../../config/env"
import { createDevotionalLlm, type DevotionalLlm } from "./llm"
import {
  JESUS_FILM_CHAPTERS,
  type JesusFilmChapter,
} from "./jesus-film-catalog"
import type { MatchVideoOptions, VideoMatchResult } from "./video-matcher"

/**
 * Local replacement for the admin-search-backed `matchVideo`, for local dev and
 * testing where the admin semantic-search API isn't reachable.
 *
 * An LLM picks the single most relevant JESUS-film chapter (from the 61-chapter
 * catalog) for the day's scripture + hook; the result references that chapter by
 * its Arclight id and title. You map the chosen title → a video file you upload.
 * Drop-in for the workflow's `matchVideo` dependency seam — same call shape
 * (`{ scripture, hook }`), same `VideoMatchResult` return.
 *
 * Always returns a clip (the requirements' always-a-clip rule): an LLM hit →
 * `search`; a deterministic keyword fallback when the LLM is unavailable →
 * `fallback`.
 */

const PickSchema = z
  .object({
    index: z.number().int(),
    reason: z.string().trim().max(280).optional(),
  })
  .strict()

const PICK_JSON_SCHEMA = {
  name: "jesus_film_chapter_pick",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      index: { type: "integer" },
      reason: { type: "string", maxLength: 280 },
    },
    required: ["index"],
  },
}

const SYSTEM_PROMPT = [
  "You choose the single best chapter of the JESUS film (Gospel of Luke) to",
  "accompany a daily devotional. Pick the chapter whose scene most directly",
  "illustrates the devotional's scripture and theme. Prefer a narrative scene",
  "over a teaching summary when both fit. Return JSON only: the chapter index",
  "(1-61) and a short reason.",
].join("\n")

function renderCatalog(chapters: ReadonlyArray<JesusFilmChapter>): string {
  return chapters.map((c) => `${c.index}. ${c.title}`).join("\n")
}

function toResult(
  chapter: JesusFilmChapter,
  source: "search" | "fallback",
): VideoMatchResult {
  return {
    video: {
      videoId: chapter.id,
      title: chapter.title,
      // The picked chapter id doubles as the slug you map to an uploaded file.
      url: chapter.id,
      thumbnailUrl: null,
    },
    videoMatch: source,
  }
}

/**
 * Deterministic, dependency-free fallback: pick the chapter whose title shares
 * the most words with the scripture reference + hook title. Guarantees a clip
 * even with no LLM/network.
 */
function keywordFallback(options: MatchVideoOptions): VideoMatchResult {
  const needle = `${options.scripture.reference} ${options.hook.title}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3)
  const scored = JESUS_FILM_CHAPTERS.map((chapter) => {
    const words = new Set(chapter.title.toLowerCase().split(/[^a-z0-9]+/))
    const overlap = needle.filter((w) => words.has(w)).length
    return { chapter, overlap }
  })
  const best = scored.reduce((top, cur) =>
    cur.overlap > top.overlap ? cur : top,
  )
  // No overlap at all → the opening chapter is a safe, on-theme default.
  return toResult(
    best.overlap > 0 ? best.chapter : JESUS_FILM_CHAPTERS[0],
    "fallback",
  )
}

export type CreateLocalVideoMatcherDeps = {
  /** Override the picker LLM (tests inject a fake). */
  llm?: DevotionalLlm
  catalog?: ReadonlyArray<JesusFilmChapter>
}

/**
 * Build a `matchVideo`-shaped function backed by the local catalog. Constructs
 * its own LLM from env lazily (the workflow calls matchVideo without an llm),
 * so a missing key degrades to the keyword fallback rather than throwing.
 */
export function createLocalVideoMatcher(
  deps: CreateLocalVideoMatcherDeps = {},
): (options: MatchVideoOptions) => Promise<VideoMatchResult> {
  const catalog = deps.catalog ?? JESUS_FILM_CHAPTERS

  return async (options) => {
    let llm = deps.llm
    if (!llm) {
      try {
        llm = createDevotionalLlm({ model: getDevotionalModel() })
      } catch {
        return keywordFallback(options)
      }
    }

    try {
      const pick = await llm.complete({
        system: SYSTEM_PROMPT,
        user: [
          `Scripture: ${options.scripture.reference} — ${options.scripture.text}`,
          `Hook (${options.hook.type}): ${options.hook.title} — ${options.hook.summary}`,
          "",
          "JESUS film chapters:",
          renderCatalog(catalog),
        ].join("\n"),
        jsonSchema: PICK_JSON_SCHEMA,
        schema: PickSchema,
        temperature: 0.2,
        maxTokens: 200,
      })
      const chapter = catalog.find((c) => c.index === pick.index)
      if (!chapter) return keywordFallback(options)
      return toResult(chapter, "search")
    } catch {
      return keywordFallback(options)
    }
  }
}

export const _internal = { keywordFallback, renderCatalog }
