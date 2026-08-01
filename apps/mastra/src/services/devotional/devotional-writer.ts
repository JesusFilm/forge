import { z } from "zod"

import { getFirecrawlConfig, type FirecrawlConfig } from "../../config/env"
import { searchFirecrawl } from "../firecrawl-client"
import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import { requireAuthoredPrompt } from "./authored-data"
import {
  DEVOTIONAL_BLOCKS,
  MAX_DEVOTIONAL_QUESTIONS,
  MAX_DEVOTIONAL_SHORT_TEXT,
  MAX_DEVOTIONAL_TEXT_LENGTH,
  MAX_DEVOTIONAL_URL,
  type Devotional,
  type DevotionalBlock,
  type Hook,
  type ScriptureRef,
  type VideoClip,
  type VideoMatchSource,
} from "./types"

/**
 * Compose the original reflection (grounded in partner teaching), the
 * reflection questions, an optional further-reading link, and the flexible
 * per-day block order. Grounding is best-effort: a partner-search failure still
 * yields a devotional (without a link). The writer never republishes partner
 * text — it writes original prose and may link one partner piece, with the
 * link enforced against the configured domain allowlist.
 */

const MAX_GROUNDING_SNIPPETS = 4

/**
 * Allowed full-block arrangements. The per-day pick is deterministic by date
 * (so reruns are stable) but varies across days so the page never feels
 * formulaic. Reflection precedes questions in every arrangement; the lead
 * ingredients (hook / scripture / video) rotate.
 */
const WriterResponseSchema = z
  .object({
    reflection: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
    questions: z
      .array(z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT))
      .min(1)
      .max(MAX_DEVOTIONAL_QUESTIONS),
    furtherReading: z.string().trim().max(MAX_DEVOTIONAL_URL).optional(),
  })
  .strict()

const WRITER_JSON_SCHEMA = {
  name: "devotional_writer",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reflection: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
      // NOTE: no minItems/maxItems — Anthropic's structured-output schema
      // (the default DEVOTIONAL_MODEL provider) rejects array item-count
      // constraints ("For 'array' type, property 'maxItems' is not supported").
      // The count is steered by the prompt ("2 to 3 questions") and enforced by
      // WriterResponseSchema (.min(1).max) after parse.
      questions: {
        type: "array",
        items: {
          type: "string",
          minLength: 1,
          maxLength: MAX_DEVOTIONAL_SHORT_TEXT,
        },
      },
      furtherReading: { type: "string", maxLength: MAX_DEVOTIONAL_URL },
    },
    required: ["reflection", "questions"],
  },
}

export type GroundingSnippet = {
  url: string
  title: string | null
  snippet: string | null
}

export type GroundingSearchFn = (input: {
  query: string
  partnerDomains: string[]
  firecrawlConfig: FirecrawlConfig
}) => Promise<GroundingSnippet[]>

export class DevotionalWriterError extends Error {
  constructor(
    readonly code: "generation_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "DevotionalWriterError"
  }
}

export type WriteDevotionalOptions = {
  date: string
  hook: Hook
  scripture: ScriptureRef
  video: VideoClip | null
  videoMatch: VideoMatchSource
  llm: DevotionalLlm
  partnerDomains?: string[]
  firecrawlConfig?: FirecrawlConfig
  grounding?: GroundingSearchFn
  systemPrompt?: string
  blockOrders?: DevotionalBlock[][]
}

function partnerUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function isAllowedPartnerUrl(url: string, partnerDomains: string[]): boolean {
  const parsed = partnerUrl(url)
  if (
    !parsed ||
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return false
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  return partnerDomains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  )
}

function presentBlocks(video: VideoClip | null): DevotionalBlock[] {
  return DEVOTIONAL_BLOCKS.filter((block) =>
    block === "video" ? video !== null : true,
  )
}

function dateHash(date: string): number {
  let hash = 0
  for (const char of date) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash
}

export function chooseBlockOrder(
  date: string,
  present: DevotionalBlock[],
  blockOrders?: DevotionalBlock[][],
): DevotionalBlock[] {
  if (!blockOrders?.length) {
    throw new Error(
      "/inputs/prompts/generation.json: blockOrders configuration is required",
    )
  }
  const base = blockOrders[dateHash(date) % blockOrders.length]!
  const presentSet = new Set(present)
  return base.filter((block) => presentSet.has(block))
}

async function defaultGroundingSearch({
  query,
  partnerDomains,
  firecrawlConfig,
}: {
  query: string
  partnerDomains: string[]
  firecrawlConfig: FirecrawlConfig
}): Promise<GroundingSnippet[]> {
  if (partnerDomains.length === 0 || !firecrawlConfig.apiKey) return []
  const sites = partnerDomains
    .slice(0, 4)
    .map((domain) => `site:${domain}`)
    .join(" OR ")
  const response = await searchFirecrawl({
    query: `${query} (${sites})`,
    config: firecrawlConfig,
  })
  if (!response.ok)
    throw new Error(`grounding search failed: ${response.reason}`)
  return response.result.results
    .filter((hit) => isAllowedPartnerUrl(hit.url, partnerDomains))
    .map((hit) => ({
      url: hit.url,
      title: hit.title,
      snippet: hit.description ?? hit.markdown,
    }))
}

function renderGrounding(snippets: readonly GroundingSnippet[]): string {
  if (snippets.length === 0) return "(no partner teaching available)"
  return snippets
    .slice(0, MAX_GROUNDING_SNIPPETS)
    .map((snippet, index) => {
      const title = snippet.title ?? "(untitled)"
      const body = snippet.snippet ?? "(no excerpt)"
      return `${index + 1}. ${title} — ${body} [${snippet.url}]`
    })
    .join("\n")
}

export async function writeDevotional(
  options: WriteDevotionalOptions,
): Promise<Devotional> {
  const systemPrompt = requireAuthoredPrompt(options.systemPrompt)
  if (!options.partnerDomains) {
    throw new Error(
      "/inputs/prompts/generation.json: partnerDomains configuration is required",
    )
  }
  const partnerDomains = options.partnerDomains
  const firecrawlConfig = options.firecrawlConfig ?? getFirecrawlConfig()
  const groundingSearch = options.grounding ?? defaultGroundingSearch

  let grounding: GroundingSnippet[] = []
  try {
    grounding = await groundingSearch({
      query: `${options.scripture.reference} ${options.hook.title}`,
      partnerDomains,
      firecrawlConfig,
    })
  } catch {
    // Grounding is best-effort — proceed without it (and without a link).
    grounding = []
  }

  let response: z.infer<typeof WriterResponseSchema>
  try {
    response = await options.llm.complete({
      system: systemPrompt,
      user: [
        `Date: ${options.date}`,
        `Hook (${options.hook.type}): ${options.hook.title} — ${options.hook.summary}`,
        `Scripture ${options.scripture.reference}: ${options.scripture.text}`,
        options.video
          ? `Video clip: ${options.video.title}`
          : "Video clip: (none)",
        "Trusted partner teaching (for grounding only — do not copy):",
        renderGrounding(grounding),
      ].join("\n"),
      jsonSchema: WRITER_JSON_SCHEMA,
      schema: WriterResponseSchema,
      temperature: 0.6,
      maxTokens: 1400,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      throw new DevotionalWriterError(
        "generation_failed",
        `devotional writing failed: ${error.code}: ${error.message}`,
        error,
      )
    }
    throw error
  }

  // Enforce the allowlist: only keep a link to a configured partner domain.
  const furtherReading =
    response.furtherReading &&
    isAllowedPartnerUrl(response.furtherReading, partnerDomains)
      ? response.furtherReading
      : null

  return {
    date: options.date,
    hook: options.hook,
    scripture: options.scripture,
    video: options.video,
    videoMatch: options.videoMatch,
    reflection: response.reflection,
    questions: response.questions,
    furtherReading,
    blockOrder: chooseBlockOrder(
      options.date,
      presentBlocks(options.video),
      options.blockOrders,
    ),
  }
}

export const _internal = {
  presentBlocks,
  isAllowedPartnerUrl,
  WRITER_JSON_SCHEMA,
}
