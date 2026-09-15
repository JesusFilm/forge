// Experience vector search — Search Hydration Pattern.
//
// 1. Raw SQL with pgvector: cosine distance on ExperienceLocale.embedding
// 2. Returns { id, distance } tuples ordered by similarity
// 3. Hydrates via prisma.experienceLocale.findMany with Pothos query
//    passthrough, re-applying ABAC WHERE (permission filter at hydration)
// 4. Preserves search order in the final result (not Prisma's default)
//
// SET LOCAL + search query are wrapped in an interactive $transaction so
// the optional pgvector tuning parameter is scoped to the search
// transaction (SET LOCAL only persists within a transaction block).
//
// Per Unit 8 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { Prisma, type PrismaClient } from "@prisma/client"
import { isEditorOrAdmin, type Principal } from "@/auth/principal"
import { toPgVector } from "@/db/pgvector"
import { activeExperienceContentEmbeddingWhere } from "./content-embedding-contract"

type SearchHit = { id: string; distance: number }

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

export class ExperienceSearchService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Semantic search over ExperienceLocale embeddings.
   *
   * The query uses raw pgvector cosine distance over non-null
   * `experience_locale.embedding` rows. `hnsw.ef_search` is harmless when
   * no HNSW index is present and stays scoped via SET LOCAL inside an
   * interactive transaction.
   */
  async search({
    vector,
    locale,
    limit = 10,
    efSearch = 40,
    user,
    query,
  }: {
    vector: unknown
    locale?: string
    limit?: number
    efSearch?: number
    user: Principal | null
    query: object
  }) {
    const safeVector = validateVector(vector)
    const isPrivileged = isEditorOrAdmin(user)

    const safeEfSearch = Math.max(1, Math.min(500, Number(efSearch) || 40))
    const pgVector = toPgVector(safeVector)

    // Locale + permission filters for raw SQL (uses DB-level enum values)
    const localeFilter = locale
      ? Prisma.sql`AND el.locale = ${locale}`
      : Prisma.empty
    // DB stores 'published' (lowercase via @map); raw SQL must match.
    const statusFilter = isPrivileged
      ? Prisma.empty
      : Prisma.sql`AND el.status = 'published'`
    const archiveFilter = isPrivileged
      ? Prisma.empty
      : Prisma.sql`AND e.archived_at IS NULL`

    // Wrap SET LOCAL + search in a transaction so ef_search applies.
    const hits = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL hnsw.ef_search = ${safeEfSearch}`
      return tx.$queryRaw<SearchHit[]>`
        SELECT el.id, el.embedding <=> ${pgVector}::vector AS distance
        FROM experience_locale el
        JOIN experience e ON e.id = el.experience_id
        WHERE el.embedding IS NOT NULL
          ${activeExperienceContentEmbeddingWhere("el")}
          ${localeFilter}
          ${statusFilter}
          ${archiveFilter}
        ORDER BY distance
        LIMIT ${limit}
      `
    })

    if (hits.length === 0) return []

    // Hydrate via Prisma with Pothos query passthrough + permission WHERE.
    // ABAC re-applied at hydration as defense-in-depth (matches raw SQL
    // filters; catches rows that changed state between the two queries).
    const ids = hits.map((h) => h.id)
    const rows = await this.prisma.experienceLocale.findMany({
      ...query,
      where: {
        id: { in: ids },
        ...(isPrivileged ? {} : { status: "PUBLISHED" }),
        ...(isPrivileged ? {} : { experience: { archivedAt: null } }),
      },
    })

    // Preserve search order (Prisma returns in arbitrary order)
    const byId = new Map(rows.map((r) => [r.id, r]))
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r != null)
  }
}
