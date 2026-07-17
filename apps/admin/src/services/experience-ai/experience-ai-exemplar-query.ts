/**
 * pgvector queries for AI-generation exemplars.
 *
 * Kept as standalone functions (NOT methods on `ExperienceSearchService`)
 * on purpose: the search service is registered in the request-scoped
 * `Services` registry, whose type is imported broadly across the admin
 * program. Growing it nudges the whole program past TypeScript's
 * type-instantiation budget, which surfaces as unrelated `void | T`
 * inference failures in Mastra `createTool` consumers. A feature-local
 * module keeps that blast radius at zero.
 *
 * Hydration uses `$queryRaw` (not `findMany({ select })`) so the row type
 * comes from an explicit generic rather than Prisma's heavy select
 * inference, and the vector scan + copy hydration share one round-trip.
 */

import { Prisma, type PrismaClient } from "@prisma/client"
import { toPgVector } from "@/db/pgvector"

// Embedding provenance the relevance query must match. Mirrors the
// canonical filter in hybrid-search-retrievers.ts (QWEN_CONTENT_EMBEDDING_*)
// so we only ever compare a Qwen query vector against Qwen-space stored
// vectors — never against legacy-provider or mid-migration vectors that
// share the same column. Kept as local constants (not imported) to avoid
// pulling the heavy hybrid-search module's type graph into this file; if
// the gateway provenance changes, update both sites together.
const CONTENT_EMBEDDING_PROVIDER = "jesus-film-ai-gateway"
const CONTENT_EMBEDDING_NATIVE_DIMENSIONS = 1536
// Per-call statement timeout for the vector scan, well under the draft
// action's budget so a slow DB / lock degrades to the fallback instead of
// hanging the generation request.
const EXEMPLAR_QUERY_STATEMENT_TIMEOUT_MS = 5000

/** Minimal Prisma surface these queries need. */
export type ExemplarQueryClient = Pick<
  PrismaClient,
  "$queryRaw" | "$transaction"
>

/**
 * A published ExperienceLocale surfaced as a structure-and-voice exemplar.
 * `distance` is the cosine distance for a relevance match, `null` for the
 * slug-resolved fallback. `blocks` is raw stored JSON — the outline
 * builder reduces it to structure + copy with video ids stripped. The
 * `embedding` vector is never selected.
 */
export type ExemplarRow = {
  id: string
  locale: string
  title: string | null
  metaDescription: string | null
  blocks: unknown
  distance: number | null
}

type ExemplarSqlRow = {
  id: string
  locale: string
  title: string | null
  metaDescription: string | null
  blocks: unknown
}

function validateVector(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new Error("vector must be an array of numbers")
  }
  if (input.length === 0 || input.length > 4096) {
    throw new Error(`vector length ${input.length} out of range (1-4096)`)
  }
  for (let i = 0; i < input.length; i++) {
    if (typeof input[i] !== "number" || !Number.isFinite(input[i])) {
      throw new Error(`vector[${i}] is not a finite number`)
    }
  }
  return input as number[]
}

/**
 * Find the published ExperienceLocale(s) most similar to a query vector.
 * Always the published / non-archived view, returns cosine `distance` so
 * the caller can threshold, and excludes the experience being edited so a
 * page is never its own exemplar. SET LOCAL + scan share one transaction
 * so `hnsw.ef_search` actually applies.
 */
export async function findExperienceExemplar(
  prisma: ExemplarQueryClient,
  {
    vector,
    locale,
    excludeExperienceId,
    limit = 1,
    efSearch = 40,
  }: {
    vector: unknown
    locale?: string
    excludeExperienceId?: string
    limit?: number
    efSearch?: number
  },
): Promise<ExemplarRow[]> {
  const safeVector = validateVector(vector)
  const safeEfSearch = Math.max(1, Math.min(500, Number(efSearch) || 40))
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 1))
  const pgVector = toPgVector(safeVector)

  const localeFilter = locale
    ? Prisma.sql`AND el.locale = ${locale}`
    : Prisma.empty
  const excludeFilter = excludeExperienceId
    ? Prisma.sql`AND el.experience_id <> ${excludeExperienceId}`
    : Prisma.empty

  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = ${EXEMPLAR_QUERY_STATEMENT_TIMEOUT_MS}`
    await tx.$executeRaw`SET LOCAL hnsw.ef_search = ${safeEfSearch}`
    return tx.$queryRaw<Array<ExemplarSqlRow & { distance: number }>>`
      SELECT el.id,
             el.locale,
             el.title,
             el.meta_description AS "metaDescription",
             el.blocks,
             (el.embedding <=> ${pgVector}::vector) AS distance
      FROM experience_locale el
      JOIN experience e ON e.id = el.experience_id
      WHERE el.embedding IS NOT NULL
        AND el.status = 'published'
        AND e.archived_at IS NULL
        AND el.embedding_provider = ${CONTENT_EMBEDDING_PROVIDER}
        AND el.embedding_native_dimensions = ${CONTENT_EMBEDDING_NATIVE_DIMENSIONS}
        AND el.embedding_transform_version IS NULL
        ${localeFilter}
        ${excludeFilter}
      ORDER BY distance
      LIMIT ${safeLimit}
    `
  })

  return rows.map((r) => ({
    id: r.id,
    locale: r.locale,
    title: r.title,
    metaDescription: r.metaDescription,
    blocks: r.blocks,
    // pg may return a numeric column as a string depending on driver/type;
    // coerce so the caller's `distance <= threshold` is a numeric compare.
    distance: Number(r.distance),
  }))
}

/**
 * Resolve the fallback exemplar by slug (the Easter page), used when no
 * published page is a good enough relevance match. Prefers the requested
 * locale, then any locale. A non-null embedding is NOT required (the
 * fallback is consumed for structure + copy only). Returns `null` when no
 * published, non-archived locale with that slug exists.
 */
export async function findFallbackExperienceExemplar(
  prisma: ExemplarQueryClient,
  {
    slug,
    locale,
    excludeExperienceId,
  }: { slug: string; locale?: string; excludeExperienceId?: string },
): Promise<ExemplarRow | null> {
  // Honor the same self-exclusion as findExperienceExemplar: when the page
  // being edited IS the fallback (e.g. regenerating the Easter page itself,
  // whose slug equals the fallback slug), it must not become its own
  // structure-and-voice exemplar.
  const excludeFilter = excludeExperienceId
    ? Prisma.sql`AND el.experience_id <> ${excludeExperienceId}`
    : Prisma.empty
  const rows = await prisma.$queryRaw<ExemplarSqlRow[]>`
    SELECT el.id,
           el.locale,
           el.title,
           el.meta_description AS "metaDescription",
           el.blocks
    FROM experience_locale el
    JOIN experience e ON e.id = el.experience_id
    WHERE el.slug = ${slug}
      AND el.status = 'published'
      AND e.archived_at IS NULL
      ${excludeFilter}
  `
  if (rows.length === 0) return null
  const preferred =
    (locale ? rows.find((r) => r.locale === locale) : undefined) ?? rows[0]!
  return { ...preferred, distance: null }
}
