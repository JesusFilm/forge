// Server-only: composes a prompt from the user's query + a compact view of
// search results, asks gpt-4o-mini (via OpenRouter) to return a structured
// mini-experience, validates the response against a Zod schema, and filters
// out any video slugs the model hallucinated outside the input set.
//
// The CMS side uses the openai SDK (apps/cms/src/lib/openrouter.ts); this
// side uses raw fetch. Single call site + zero need for streaming / embeddings
// means pulling in the SDK buys nothing but bundle weight.

import { z } from "zod"

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = "openai/gpt-4o-mini"
const TIMEOUT_MS = 15_000
const MAX_COMPLETION_TOKENS = 800

export type CompactResult = {
  slug: string
  title: string
  snippet: string
}

const SpotlightSection = z.object({
  type: z.literal("spotlight"),
  videoSlug: z.string(),
  why: z.string(),
})

const ThemeCarouselSection = z.object({
  type: z.literal("theme-carousel"),
  theme: z.string(),
  videoSlugs: z.array(z.string()).min(1).max(5),
  caption: z.string(),
})

const BibleVerseSection = z.object({
  type: z.literal("bible-verse"),
  reference: z.string(),
  text: z.string(),
  reflection: z.string(),
})

const ExperienceSection = z.discriminatedUnion("type", [
  SpotlightSection,
  ThemeCarouselSection,
  BibleVerseSection,
])

export const ExperienceSchema = z.object({
  title: z.string().min(1),
  intro: z.string().min(1),
  sections: z.array(ExperienceSection).min(1).max(3),
})

export type Experience = z.infer<typeof ExperienceSchema>
export type ExperienceSectionNode = z.infer<typeof ExperienceSection>

export type ExperienceGeneratorErrorCode =
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "SCHEMA_MISMATCH"
  | "NO_VALID_SECTIONS"

export class ExperienceGeneratorError extends Error {
  code: ExperienceGeneratorErrorCode
  constructor(code: ExperienceGeneratorErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = "ExperienceGeneratorError"
  }
}

const SYSTEM_PROMPT = [
  "You are a JesusFilm content curator composing a brief, reverent themed experience from a catalog of videos.",
  "Given a user query and a list of candidate videos (each with slug, title, snippet), compose a short experience with 2 or 3 sections.",
  "Section types:",
  '- "spotlight": pick ONE videoSlug you think is the strongest lead for this query. Give a one-sentence reason.',
  '- "theme-carousel": a tight theme (e.g. "The Resurrection", "Stories of Forgiveness") and 3 to 5 videoSlugs that fit it. Add a one-sentence caption.',
  '- "bible-verse": a single scripture reference and its text (from canonical scripture you know well), plus a one or two sentence reflection that ties the verse to the query. Do not invent verses.',
  "Rules:",
  "- Every videoSlug in your response MUST come from the provided candidate list. Do not invent slugs.",
  "- Keep copy warm, direct, and jargon-free. Avoid promotional marketing voice.",
  "- Output strictly matches the JSON schema you're given. No prose outside the JSON.",
].join("\n")

const RESPONSE_JSON_SCHEMA = {
  name: "mini_experience",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "intro", "sections"],
    properties: {
      title: { type: "string" },
      intro: { type: "string" },
      sections: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "videoSlug", "why"],
              properties: {
                type: { type: "string", enum: ["spotlight"] },
                videoSlug: { type: "string" },
                why: { type: "string" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "theme", "videoSlugs", "caption"],
              properties: {
                type: { type: "string", enum: ["theme-carousel"] },
                theme: { type: "string" },
                videoSlugs: {
                  type: "array",
                  minItems: 3,
                  maxItems: 5,
                  items: { type: "string" },
                },
                caption: { type: "string" },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "reference", "text", "reflection"],
              properties: {
                type: { type: "string", enum: ["bible-verse"] },
                reference: { type: "string" },
                text: { type: "string" },
                reflection: { type: "string" },
              },
            },
          ],
        },
      },
    },
  },
}

function buildUserPrompt(query: string, results: CompactResult[]): string {
  const catalog = results
    .map((r, i) => `${i + 1}. slug=${r.slug} — ${r.title}: ${r.snippet}`)
    .join("\n")
  return `User query: ${query}\n\nCandidate videos:\n${catalog}`
}

async function postToOpenRouter(
  apiKey: string,
  body: unknown,
): Promise<Response> {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://jesusfilm.org",
      "X-Title": "JesusFilm demo-search experience generator",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

function filterToAllowedSlugs(
  experience: Experience,
  allowed: Set<string>,
): Experience | null {
  const kept: ExperienceSectionNode[] = []
  for (const section of experience.sections) {
    if (section.type === "spotlight") {
      if (allowed.has(section.videoSlug)) kept.push(section)
      continue
    }
    if (section.type === "theme-carousel") {
      const filtered = section.videoSlugs.filter((slug) => allowed.has(slug))
      if (filtered.length >= 1) {
        kept.push({ ...section, videoSlugs: filtered.slice(0, 5) })
      }
      continue
    }
    // bible-verse — no slugs to filter; always keep.
    kept.push(section)
  }
  if (kept.length === 0) return null
  return { ...experience, sections: kept }
}

export type GeneratedExperience = {
  experience: Experience
  latencyMs: number
}

export async function generateExperience(
  query: string,
  results: CompactResult[],
): Promise<GeneratedExperience> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new ExperienceGeneratorError(
      "NOT_CONFIGURED",
      "OPENROUTER_API_KEY is not set on this deployment",
    )
  }

  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(query, results) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: RESPONSE_JSON_SCHEMA,
    },
    temperature: 0.4,
    max_tokens: MAX_COMPLETION_TOKENS,
  }

  const startedAt = performance.now()
  let response: Response
  try {
    response = await postToOpenRouter(apiKey, body)
    if (response.status >= 500) {
      // One retry on 5xx after a short backoff.
      await new Promise((resolve) => setTimeout(resolve, 500))
      response = await postToOpenRouter(apiKey, body)
    }
  } catch (err) {
    throw new ExperienceGeneratorError(
      "UPSTREAM_ERROR",
      err instanceof Error ? err.message : "Network error",
    )
  }

  if (!response.ok) {
    throw new ExperienceGeneratorError(
      "UPSTREAM_ERROR",
      `OpenRouter returned HTTP ${response.status}`,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ExperienceGeneratorError(
      "UPSTREAM_ERROR",
      "OpenRouter response was not valid JSON",
    )
  }

  const content = (
    payload as {
      choices?: { message?: { content?: string } }[]
    }
  )?.choices?.[0]?.message?.content
  if (typeof content !== "string" || content.length === 0) {
    throw new ExperienceGeneratorError(
      "UPSTREAM_ERROR",
      "OpenRouter response had no message content",
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new ExperienceGeneratorError(
      "SCHEMA_MISMATCH",
      "Model response was not valid JSON",
    )
  }

  const zResult = ExperienceSchema.safeParse(parsed)
  if (!zResult.success) {
    throw new ExperienceGeneratorError(
      "SCHEMA_MISMATCH",
      "Model response did not match expected schema",
    )
  }

  const allowed = new Set(results.map((r) => r.slug))
  const filtered = filterToAllowedSlugs(zResult.data, allowed)
  if (filtered === null) {
    throw new ExperienceGeneratorError(
      "NO_VALID_SECTIONS",
      "Model response referenced no in-catalog videos",
    )
  }

  return { experience: filtered, latencyMs: performance.now() - startedAt }
}
