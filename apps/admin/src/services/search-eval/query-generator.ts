/**
 * Synthetic query generator.
 *
 * For each locale in the harness set, asks the OpenRouter judge model
 * to produce a list of plausible search queries that real users might
 * type. Queries are persisted at
 * `apps/admin/eval/synthetic-queries/{locale}.json` and committed to
 * the repo — running the harness against the same baseline must use
 * the same query set, so regeneration is an explicit command (not
 * automatic per run).
 *
 * Generation is deliberately corpus-blind. We do not show the LLM
 * any indexed content; queries should reflect "what would someone
 * struggling with X type?" rather than excerpts of the corpus
 * (which would inflate scores via leakage). Per plan §R2.
 *
 * Prompt quality across 30 locales is post-v1 iteration. The prompt
 * here is a working baseline; expect to tune per locale once
 * calibration surfaces noise.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { env } from "@/config/env"

import { DEFAULT_JUDGE_MODEL } from "./judge"
import { extractMessageContent, safeReadBody } from "./openrouter-helpers"
import { syntheticQueriesDir } from "./paths"
import type { QuerySource } from "./types"

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions"

const QUERY_GENERATOR_TIMEOUT_MS = 60_000
const DEFAULT_QUERY_COUNT = 50

/** Schema validates the LLM output. Bounds force the model to respect
 *  the requested count + drops empty entries. Single-codepoint queries
 *  are legitimate in CJK locales (`愛`, `恵`), so the per-item floor is
 *  1 char, not 2. */
const QueryGeneratorResponseSchema = z.object({
  queries: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
})

export class QueryGeneratorError extends Error {
  constructor(
    readonly code:
      | "missing_credentials"
      | "request_failed"
      | "validation"
      | "timeout"
      | "transport",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "QueryGeneratorError"
  }
}

export type SyntheticQueriesFile = {
  schemaVersion: "1"
  locale: string
  generatedAt: string
  model: string
  queries: string[]
}

export type LoadedSyntheticQuery = {
  locale: string
  query: string
  source: QuerySource
}

export type QueryGeneratorOptions = {
  fetchImpl?: typeof fetch
  apiKey?: string
  model?: string
  timeoutMs?: number
}

export type QueryGenerator = {
  generateQueries: (locale: string, count?: number) => Promise<string[]>
  readonly model: string
}

/** Build a query-generator client. Factory shape so tests can inject
 *  fetchImpl + key without `vi.stubGlobal`. */
export function createQueryGenerator(
  options: QueryGeneratorOptions = {},
): QueryGenerator {
  const apiKey = options.apiKey ?? env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new QueryGeneratorError(
      "missing_credentials",
      "OPENROUTER_API_KEY is required to generate synthetic queries",
    )
  }
  const model =
    options.model ?? env.OPENROUTER_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? QUERY_GENERATOR_TIMEOUT_MS

  return {
    model,
    async generateQueries(locale, count = DEFAULT_QUERY_COUNT) {
      const body = JSON.stringify(buildRequestBody(model, locale, count))
      let response: Response
      try {
        response = await fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://admin.jesusfilm.org",
            "X-OpenRouter-Title": "Forge Admin Eval Harness (query-gen)",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "TimeoutError") {
          throw new QueryGeneratorError(
            "timeout",
            `query-generator timed out after ${timeoutMs}ms`,
            cause,
          )
        }
        throw new QueryGeneratorError(
          "transport",
          cause instanceof Error ? cause.message : String(cause),
          cause,
        )
      }

      if (!response.ok) {
        const body = await safeReadBody(response)
        throw new QueryGeneratorError(
          "request_failed",
          `query-generator status ${response.status}: ${body.slice(0, 500)}`,
        )
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch (cause) {
        throw new QueryGeneratorError(
          "validation",
          "query-generator response was not valid JSON",
          cause,
        )
      }

      const text = extractMessageContent(payload)
      if (text == null) {
        throw new QueryGeneratorError(
          "validation",
          "query-generator response did not include text output",
        )
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(text)
      } catch (cause) {
        throw new QueryGeneratorError(
          "validation",
          "query-generator response text was not valid JSON",
          cause,
        )
      }

      const validated = QueryGeneratorResponseSchema.safeParse(parsedJson)
      if (!validated.success) {
        throw new QueryGeneratorError(
          "validation",
          `query-generator response failed schema validation: ${validated.error.issues.map((i) => i.message).join(", ")}`,
        )
      }

      // Dedupe + trim again defensively.
      const seen = new Set<string>()
      const unique: string[] = []
      for (const q of validated.data.queries) {
        const trimmed = q.trim()
        if (trimmed.length === 0 || seen.has(trimmed)) continue
        seen.add(trimmed)
        unique.push(trimmed)
      }
      return unique
    },
  }
}

function buildRequestBody(model: string, locale: string, count: number) {
  return {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(locale, count) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "synthetic_queries",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            queries: {
              type: "array",
              minItems: 1,
              maxItems: 200,
              items: { type: "string", minLength: 1, maxLength: 200 },
            },
          },
          required: ["queries"],
        },
      },
    },
    max_tokens: 2000,
    temperature: 0.8,
  }
}

function buildSystemPrompt(): string {
  return [
    "You generate realistic search queries that users of a Christian video & content platform might type.",
    "The platform offers Bible-based videos, biographical content about Jesus, theme-based collections, and discipleship resources across many languages.",
    "Generated queries should reflect what real users would actually search for — not excerpts from any specific corpus.",
    "Cover a mix: themes (e.g. hope, forgiveness, suffering), felt needs (anxiety, loneliness), bible references (book + chapter + verse), specific concepts (parables, miracles), and free-form phrasings.",
    "Vary length: some 1-2 word queries, some short phrases, some full questions.",
    "Do NOT include search-engine syntax (no quotes, OR, site:, etc.) — these should look like end-user input.",
    "Output JSON matching the schema. Do not include any other text.",
  ].join("\n")
}

function buildUserPrompt(locale: string, count: number): string {
  return [
    `Generate ${count} distinct search queries that a user of locale "${locale}" might type into the platform's search box.`,
    `Write the queries IN the language of "${locale}" — not in English unless ${locale} is English.`,
    "Each query should be a plain string (no numbering, no bullet points, no extra punctuation).",
    `Return JSON: { "queries": [<${count} strings>] }`,
  ].join("\n")
}

// ---------- File persistence ----------

export type CreateLoaderOptions = {
  /** Directory holding the per-locale JSON files. Override for tests.
   *  Defaults to `apps/admin/eval/synthetic-queries/`. */
  directory?: string
  /** Used when generating; defaults to `createQueryGenerator()`. */
  generator?: QueryGenerator
  /** Defaults to the generator's model id. */
  modelLabel?: string
  /** For tests / explicit-time control. */
  now?: () => Date
}

export type SyntheticQueryLoader = {
  /** Read a per-locale file if present; otherwise generate and write. */
  loadOrGenerate: (
    locale: string,
    count?: number,
  ) => Promise<LoadedSyntheticQuery[]>
  /** Read-only — never invokes the generator. Throws if file is missing. */
  load: (locale: string) => Promise<LoadedSyntheticQuery[]>
  /** Force regeneration + overwrite. */
  regenerate: (
    locale: string,
    count?: number,
  ) => Promise<LoadedSyntheticQuery[]>
}

const FILE_SCHEMA = z.object({
  schemaVersion: z.literal("1"),
  locale: z.string().min(1),
  generatedAt: z.string(),
  model: z.string(),
  queries: z.array(z.string().min(1)).min(1),
})

export function createSyntheticQueryLoader(
  options: CreateLoaderOptions = {},
): SyntheticQueryLoader {
  const directory = options.directory ?? syntheticQueriesDir()
  const now = options.now ?? (() => new Date())

  function getGenerator(): QueryGenerator {
    if (options.generator) return options.generator
    return createQueryGenerator()
  }

  async function readFromDisk(
    locale: string,
  ): Promise<LoadedSyntheticQuery[] | null> {
    const filePath = path.join(directory, `${locale}.json`)
    let raw: string
    try {
      raw = await readFile(filePath, "utf8")
    } catch (cause) {
      if (
        cause instanceof Error &&
        "code" in cause &&
        (cause as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null
      }
      throw new QueryGeneratorError(
        "request_failed",
        `failed to read ${filePath}: ${(cause as Error).message}`,
        cause,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      throw new QueryGeneratorError(
        "validation",
        `synthetic-queries file ${filePath} is not valid JSON`,
        cause,
      )
    }

    const validated = FILE_SCHEMA.safeParse(parsed)
    if (!validated.success) {
      throw new QueryGeneratorError(
        "validation",
        `synthetic-queries file ${filePath} failed schema validation: ${validated.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}`,
      )
    }
    return validated.data.queries.map((q) => ({
      locale: validated.data.locale,
      query: q,
      source: "synthetic" as const,
    }))
  }

  async function writeToDisk(
    locale: string,
    queries: string[],
    model: string,
  ): Promise<void> {
    await mkdir(directory, { recursive: true })
    const filePath = path.join(directory, `${locale}.json`)
    const payload: SyntheticQueriesFile = {
      schemaVersion: "1",
      locale,
      generatedAt: now().toISOString(),
      model,
      queries,
    }
    await writeFile(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8")
  }

  return {
    async load(locale) {
      const fromDisk = await readFromDisk(locale)
      if (fromDisk == null) {
        throw new QueryGeneratorError(
          "request_failed",
          `synthetic queries for locale ${locale} are not on disk; run regenerate first`,
        )
      }
      return fromDisk
    },

    async loadOrGenerate(locale, count) {
      const cached = await readFromDisk(locale)
      if (cached != null) return cached
      const generator = getGenerator()
      const queries = await generator.generateQueries(locale, count)
      await writeToDisk(locale, queries, options.modelLabel ?? generator.model)
      return queries.map((q) => ({
        locale,
        query: q,
        source: "synthetic" as const,
      }))
    },

    async regenerate(locale, count) {
      const generator = getGenerator()
      const queries = await generator.generateQueries(locale, count)
      await writeToDisk(locale, queries, options.modelLabel ?? generator.model)
      return queries.map((q) => ({
        locale,
        query: q,
        source: "synthetic" as const,
      }))
    },
  }
}
