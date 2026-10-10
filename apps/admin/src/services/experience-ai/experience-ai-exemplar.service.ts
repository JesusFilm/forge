/**
 * Select a structure-and-voice exemplar for AI experience generation.
 *
 * Per prompt: embed the prompt, find the nearest published experience by
 * cosine distance, and use it when it clears the relevance threshold;
 * otherwise fall back to the Easter experience. The exemplar is an
 * ENHANCEMENT, not a hard dependency — every failure mode (embedding
 * error/timeout, no match, missing Easter page) degrades gracefully and
 * returns `null` rather than throwing, so draft generation never breaks
 * because an exemplar was unavailable.
 *
 * A failed embedding call is logged distinctly from a genuine no-match so
 * an operator can tell an embedding outage (always-fallback) apart from a
 * relevance miss — see
 * docs/solutions/runtime-errors/silent-semantic-search-degradation-missing-openrouter-key-20260415.md.
 */

import { env } from "@/config/env"
import { generateExperienceEmbedding } from "@/services/embeddings.service"
import {
  findExperienceExemplar,
  findFallbackExperienceExemplar,
  type ExemplarQueryClient,
  type ExemplarRow,
} from "@/services/experience-ai/experience-ai-exemplar-query"

/** Cosine-distance ceiling for accepting a relevance match. Tunable via env. */
const DEFAULT_MAX_DISTANCE = 0.6
/** Fallback exemplar slug (the Easter experience). Tunable via env. */
const DEFAULT_FALLBACK_SLUG = "easter"
/**
 * Wall-clock cap for the query-embedding call, kept well below the draft
 * action's overall budget so a slow embed degrades to the fallback rather
 * than eating the whole generation window.
 */
const EMBED_TIMEOUT_MS = 10_000

export type ExemplarSelection = {
  source: "matched" | "fallback"
  /** Cosine distance for a matched row; null for the fallback. */
  distance: number | null
  row: ExemplarRow
}

export type SelectExemplarDeps = {
  prisma: ExemplarQueryClient
  /** Injectable for tests; defaults to the real embedding provider. */
  generateEmbedding?: (text: string) => Promise<{ embedding: number[] }>
}

export type SelectExemplarInput = {
  prompt: string
  locale: string
  excludeExperienceId?: string
}

class EmbedTimeoutError extends Error {
  readonly name = "EmbedTimeoutError"
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(
      () => reject(new EmbedTimeoutError("embedding exceeded budget")),
      ms,
    )
    p.then(
      (value) => {
        clearTimeout(handle)
        resolve(value)
      },
      (err) => {
        clearTimeout(handle)
        reject(err)
      },
    )
  })
}

function maxDistance(): number {
  return env.EXPERIENCE_EXEMPLAR_MAX_DISTANCE ?? DEFAULT_MAX_DISTANCE
}

function fallbackSlug(): string {
  return env.EXPERIENCE_EXEMPLAR_FALLBACK_SLUG ?? DEFAULT_FALLBACK_SLUG
}

async function resolveFallback(
  prisma: ExemplarQueryClient,
  locale: string,
  excludeExperienceId?: string,
): Promise<ExemplarSelection | null> {
  const slug = fallbackSlug()
  const row = await findFallbackExperienceExemplar(prisma, {
    slug,
    locale,
    excludeExperienceId,
  })
  if (!row) {
    // Easter page absent / unpublished in this DB. Exemplar is optional,
    // so we proceed without one — but log at error level: a missing
    // fallback is a data-quality incident (or an operator editing the
    // fallback page itself), not routine, and should surface to alerts.
    console.error(
      `[experience-ai] event=experience_exemplar.none reason=fallback_unresolved slug=${slug} locale=${locale}`,
    )
    return null
  }
  return { source: "fallback", distance: null, row }
}

/**
 * Returns the chosen exemplar, or `null` when none could be resolved.
 * Never throws on selection failure.
 */
export async function selectExperienceExemplar(
  deps: SelectExemplarDeps,
  input: SelectExemplarInput,
): Promise<ExemplarSelection | null> {
  const generateEmbedding =
    deps.generateEmbedding ?? generateExperienceEmbedding
  const prompt = input.prompt.trim()
  if (!prompt)
    return resolveFallback(deps.prisma, input.locale, input.excludeExperienceId)

  let vector: number[]
  try {
    const { embedding } = await withTimeout(
      generateEmbedding(prompt),
      EMBED_TIMEOUT_MS,
    )
    vector = embedding
  } catch (error) {
    // Embedding outage — DISTINCT from a relevance miss. Degrade to the
    // Easter fallback so generation still succeeds, but make the outage
    // observable.
    const reason =
      error instanceof EmbedTimeoutError ? "timeout" : "embedding_error"
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[experience-ai] event=experience_exemplar.embedding_failure reason=${reason} message=${message}`,
    )
    return resolveFallback(deps.prisma, input.locale, input.excludeExperienceId)
  }

  let matches: ExemplarRow[]
  try {
    matches = await findExperienceExemplar(deps.prisma, {
      vector,
      locale: input.locale,
      excludeExperienceId: input.excludeExperienceId,
      limit: 1,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[experience-ai] event=experience_exemplar.query_failure message=${message}`,
    )
    return resolveFallback(deps.prisma, input.locale, input.excludeExperienceId)
  }

  const top = matches[0]
  if (top && top.distance != null && top.distance <= maxDistance()) {
    return { source: "matched", distance: top.distance, row: top }
  }

  // No good relevance match — fall back to Easter.
  return resolveFallback(deps.prisma, input.locale, input.excludeExperienceId)
}
