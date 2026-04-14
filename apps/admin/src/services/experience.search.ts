// Experience vector search — Search Hydration Pattern.
//
// 1. Raw SQL with pgvector: cosine distance on ExperienceLocale.embedding
// 2. Returns { id, distance } tuples ordered by similarity
// 3. Hydrates via prisma.experienceLocale.findMany with Pothos query
//    passthrough, re-applying ABAC WHERE (permission filter at hydration)
// 4. Preserves search order in the final result (not Prisma's default)
//
// Per Unit 8 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { toPgVector } from "@/db/pgvector"

type SearchHit = { id: string; distance: number }

export class ExperienceSearchService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Semantic search over ExperienceLocale embeddings.
   *
   * The query uses the partial HNSW index on `experience_locale.embedding`
   * (WHERE embedding IS NOT NULL). `hnsw.ef_search` is set per-session
   * for recall tuning.
   */
  async search({
    vector,
    locale,
    limit = 10,
    efSearch = 40,
    user,
    query,
  }: {
    vector: number[]
    locale?: string
    limit?: number
    efSearch?: number
    user: Principal | null
    query: object
  }) {
    const role = user?.role ?? "PUBLIC"
    const isPrivileged = role === "ADMIN" || role === "EDITOR"

    // Set per-session HNSW recall parameter
    await this.prisma.$executeRawUnsafe(
      `SET LOCAL hnsw.ef_search = ${Number(efSearch)}`,
    )

    // Build the raw SQL for cosine distance search
    const pgVector = toPgVector(vector)
    const localeFilter = locale
      ? Prisma.sql`AND el.locale = ${locale}`
      : Prisma.empty
    const statusFilter = isPrivileged
      ? Prisma.empty
      : Prisma.sql`AND el.status = 'published'`
    const archiveFilter = isPrivileged
      ? Prisma.empty
      : Prisma.sql`AND e.archived_at IS NULL`

    const hits = await this.prisma.$queryRaw<SearchHit[]>`
      SELECT el.id, el.embedding <=> ${pgVector}::vector AS distance
      FROM experience_locale el
      JOIN experience e ON e.id = el.experience_id
      WHERE el.embedding IS NOT NULL
        ${localeFilter}
        ${statusFilter}
        ${archiveFilter}
      ORDER BY el.embedding <=> ${pgVector}::vector
      LIMIT ${limit}
    `

    if (hits.length === 0) return []

    // Hydrate via Prisma with Pothos query passthrough + permission WHERE
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
