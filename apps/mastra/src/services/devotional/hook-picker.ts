import { z } from "zod"

import { getFirecrawlConfig, type FirecrawlConfig } from "../../config/env"
import { searchFirecrawl } from "../firecrawl-client"
import type { DevotionalLlm } from "./llm"
import { MAX_DEVOTIONAL_SHORT_TEXT, type Hook } from "./types"

/**
 * Pick today's hook. Priority order from the requirements: timely world news
 * (the main hook most days) -> a fixed-date holiday / Christian-calendar
 * moment -> an intriguing-question fallback. News and the question fallback use
 * an injected LLM; news candidates come from injected Firecrawl web search.
 * Every external dependency is injectable so the unit is deterministic in tests.
 */

const MAX_NEWS_CANDIDATES = 6

/**
 * Fixed-date (MM-DD) Christian-calendar / holiday anchors. Movable feasts
 * (Easter, Pentecost, Good Friday) are intentionally omitted — they cannot be
 * keyed by MM-DD and would need a computed liturgical calendar.
 */
const HOLIDAY_TABLE: Record<string, { title: string; summary: string }> = {
  "01-01": {
    title: "New Year's Day",
    summary:
      "A threshold moment — looking back with gratitude and forward with hope.",
  },
  "01-06": {
    title: "Epiphany",
    summary:
      "The revealing of Christ to the nations, remembered with the visit of the magi.",
  },
  "10-31": {
    title: "Reformation Day",
    summary:
      "A day recalling renewal and return to scripture in the life of the church.",
  },
  "11-01": {
    title: "All Saints' Day",
    summary:
      "Remembering the faithful who have gone before across every nation and age.",
  },
  "12-24": {
    title: "Christmas Eve",
    summary:
      "The eve of the Nativity — waiting on the edge of the story of God-with-us.",
  },
  "12-25": {
    title: "Christmas Day",
    summary: "The birth of Jesus — the Word made flesh, dwelling among us.",
  },
}

const NEWS_SYSTEM_PROMPT = [
  "You select one current world-news item to anchor a daily Christian devotional.",
  "Choose a broadly relevant, widely understood event — not a niche or local story.",
  "Frame it neutrally: do NOT take a partisan or political side, do NOT name parties,",
  "candidates, or campaigns, and do NOT frame any tragedy opportunistically.",
  "If no candidate is suitable for a respectful devotional, return chosen=false.",
  "Return JSON only.",
].join("\n")

const QUESTION_SYSTEM_PROMPT = [
  "You write one short, intriguing, open-hearted question to open a daily",
  "Christian devotional when there is no timely news or holiday hook.",
  "It should invite reflection and feel evergreen, not tied to any current event.",
  "Return JSON only.",
].join("\n")

const NewsSelectionSchema = z
  .object({
    chosen: z.boolean(),
    candidateIndex: z.number().int().min(0).max(MAX_NEWS_CANDIDATES),
    title: z.string().trim().max(MAX_DEVOTIONAL_SHORT_TEXT).optional(),
    summary: z.string().trim().max(MAX_DEVOTIONAL_SHORT_TEXT).optional(),
  })
  .strict()

const QuestionSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT),
    summary: z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT),
  })
  .strict()

const NEWS_JSON_SCHEMA = {
  name: "devotional_news_hook",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      chosen: { type: "boolean" },
      candidateIndex: {
        type: "integer",
        minimum: 0,
        maximum: MAX_NEWS_CANDIDATES,
        description: "1-based selected candidate; 0 when chosen is false",
      },
      title: { type: "string", maxLength: MAX_DEVOTIONAL_SHORT_TEXT },
      summary: { type: "string", maxLength: MAX_DEVOTIONAL_SHORT_TEXT },
    },
    required: ["chosen", "candidateIndex"],
  },
}

const QUESTION_JSON_SCHEMA = {
  name: "devotional_question_hook",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_SHORT_TEXT,
      },
      summary: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_SHORT_TEXT,
      },
    },
    required: ["title", "summary"],
  },
}

export type HookPickerCandidate = {
  title: string | null
  url: string
  description: string | null
}

export type HookSearchFn = (options: {
  date: string
  firecrawlConfig: FirecrawlConfig
}) => Promise<HookPickerCandidate[]>

export type PickHookOptions = {
  /** YYYY-MM-DD. */
  date: string
  llm: DevotionalLlm
  search?: HookSearchFn
  firecrawlConfig?: FirecrawlConfig
}

function holidayKey(date: string): string {
  // Expect YYYY-MM-DD; the MM-DD tail is the table key.
  return date.slice(5, 10)
}

async function defaultHookSearch(options: {
  date: string
  firecrawlConfig: FirecrawlConfig
}): Promise<HookPickerCandidate[]> {
  if (!options.firecrawlConfig.apiKey) return []
  const response = await searchFirecrawl({
    query: "most significant world news today",
    config: options.firecrawlConfig,
  })
  if (!response.ok) {
    throw new Error(`news search failed: ${response.reason}`)
  }
  return response.result.results.map((hit) => ({
    title: hit.title,
    url: hit.url,
    description: hit.description,
  }))
}

function renderCandidates(candidates: readonly HookPickerCandidate[]): string {
  return candidates
    .slice(0, MAX_NEWS_CANDIDATES)
    .map((candidate, index) => {
      const title = candidate.title ?? "(untitled)"
      const description = candidate.description ?? "(no description)"
      return `${index + 1}. ${title} — ${description} [${candidate.url}]`
    })
    .join("\n")
}

async function tryNewsHook(
  options: PickHookOptions,
  firecrawlConfig: FirecrawlConfig,
  search: HookSearchFn,
): Promise<Hook | null> {
  let candidates: HookPickerCandidate[]
  try {
    candidates = await search({ date: options.date, firecrawlConfig })
  } catch {
    // News is best-effort; on search failure fall through to holiday/question.
    return null
  }
  if (candidates.length === 0) return null

  try {
    const selection = await options.llm.complete({
      system: NEWS_SYSTEM_PROMPT,
      user: [
        `Date: ${options.date}`,
        "Candidate news items:",
        renderCandidates(candidates),
      ].join("\n"),
      jsonSchema: NEWS_JSON_SCHEMA,
      schema: NewsSelectionSchema,
      temperature: 0.2,
      maxTokens: 500,
    })
    if (
      !selection.chosen ||
      !selection.title ||
      !selection.summary ||
      selection.candidateIndex < 1
    ) {
      return null
    }
    // The model's sourceUrl is untrusted (news candidates originate from web
    // search and feed the prompt — a crafted page could inject a javascript:
    // or phishing URL). Only accept a model-supplied URL when it exactly matches
    // a real Firecrawl candidate (which Zod already validated as a URL);
    // otherwise fall back to the top candidate. Never publish a free-form URL.
    const sourceUrl = candidates[selection.candidateIndex - 1]?.url ?? null
    if (!sourceUrl) return null
    return {
      type: "news",
      title: selection.title,
      summary: selection.summary,
      sourceUrl,
    }
  } catch {
    return null
  }
}

function holidayHook(date: string): Hook | null {
  const entry = HOLIDAY_TABLE[holidayKey(date)]
  if (!entry) return null
  return {
    type: "holiday",
    title: entry.title,
    summary: entry.summary,
    sourceUrl: null,
  }
}

async function questionHook(options: PickHookOptions): Promise<Hook> {
  const result = await options.llm.complete({
    system: QUESTION_SYSTEM_PROMPT,
    user: `Date: ${options.date}. Write one intriguing opening question and a one-sentence summary.`,
    jsonSchema: QUESTION_JSON_SCHEMA,
    schema: QuestionSchema,
    temperature: 0.7,
    maxTokens: 300,
  })
  return {
    type: "question",
    title: result.title,
    summary: result.summary,
    sourceUrl: null,
  }
}

export async function pickHook(options: PickHookOptions): Promise<Hook> {
  const firecrawlConfig = options.firecrawlConfig ?? getFirecrawlConfig()
  const search = options.search ?? defaultHookSearch

  const news = await tryNewsHook(options, firecrawlConfig, search)
  if (news) return news

  const holiday = holidayHook(options.date)
  if (holiday) return holiday

  return questionHook(options)
}

export const _internal = {
  HOLIDAY_TABLE,
  NEWS_SYSTEM_PROMPT,
  QUESTION_SYSTEM_PROMPT,
  holidayKey,
}
