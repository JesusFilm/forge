import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migrationsDir = new URL("../../prisma/migrations/", import.meta.url)
const schema = readFileSync(
  new URL("../../prisma/schema.prisma", import.meta.url),
  "utf8",
)
const expiryMigration = readFileSync(
  new URL(
    "../../prisma/migrations/20260629000100_add_expired_match_job_status/migration.sql",
    import.meta.url,
  ),
  "utf8",
)
const expiredUploadCleanupIndexMigration = readFileSync(
  new URL(
    "../../prisma/migrations/20260629000200_add_expired_upload_cleanup_index/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    name: entry.name,
    sql: readFileSync(new URL(`${entry.name}/migration.sql`, migrationsDir), {
      encoding: "utf8",
    }),
  }))

describe("mapper Prisma schema", () => {
  it("keeps the public Core identifiers unique in the catalog map", () => {
    expect(schema).toContain('coreId       String    @unique @map("core_id")')
    expect(schema).toContain(
      'videoVariantId         String          @map("video_variant_id")',
    )
    expect(schema).toContain("@@unique([coreId, videoVariantId])")
  })

  it("stores Admin catalog projection state needed for sync/indexing decisions", () => {
    expect(schema).toContain(
      'editionName            String?         @map("edition_name")',
    )
    expect(schema).toContain(
      'videoPublished         Boolean         @default(false) @map("video_published")',
    )
    expect(schema).toContain(
      'dubPublished           Boolean         @default(false) @map("dub_published")',
    )
    expect(schema).toContain(
      'videoNoIndex           Boolean         @default(false) @map("video_no_index")',
    )
    expect(schema).toContain(
      'videoDeleted           Boolean         @default(false) @map("video_deleted")',
    )
    expect(schema).toContain(
      'dubDeleted             Boolean         @default(false) @map("dub_deleted")',
    )
    expect(schema).toContain(
      'nonIndexableReason     String?         @map("non_indexable_reason")',
    )
  })

  it("allows multiple ranked variants under the same coreId for one job", () => {
    expect(schema).toContain("@@unique([jobId, rank])")
    expect(schema).toContain(
      '@@unique([jobId, coreId, videoVariantId], map: "mapper_match_candidate_job_variant_key")',
    )
    expect(schema).toContain("@@index([coreId])")
  })

  it("supports expiring queued match jobs and coordinating cleaner passes", () => {
    expect(schema).toContain('EXPIRED  @map("expired")')
    expect(schema).toContain("@@index([status, queuedAt])")
    expect(schema).toContain("model MatchJobCleanerLease")
    expect(schema).toContain('ownerToken  String   @map("owner_token")')
    expect(schema).toContain('@@map("mapper_match_job_cleaner_lease")')
  })

  it("keeps the queued-expiry migration deploy-safe and retry-friendly", () => {
    expect(expiryMigration).toContain(
      "ALTER TYPE \"match_job_status\" ADD VALUE 'expired'",
    )
    expect(expiryMigration).toContain(
      'CREATE INDEX IF NOT EXISTS "mapper_match_job_status_queued_at_idx"',
    )
    expect(expiredUploadCleanupIndexMigration).toContain(
      'CREATE INDEX IF NOT EXISTS "mapper_match_job_expired_upload_cleanup_idx"',
    )
    expect(expiredUploadCleanupIndexMigration).toContain(
      "WHERE \"status\" = 'expired'",
    )
    expect(expiryMigration).toContain('"owner_token" TEXT NOT NULL')
    expect(expiryMigration).not.toContain(
      '"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    )
  })

  it("keeps migrations compatible with Prisma deploy transactions", () => {
    expect(migrations.flatMap(findDeployTransactionViolations)).toEqual([])
  })

  it("flags migration SQL patterns that break Prisma deploy transactions", () => {
    expect(
      findDeployTransactionViolations({
        name: "bad_concurrent_index",
        sql: `
          CREATE INDEX CONCURRENTLY "mapper_match_job_status_idx"
          ON "mapper_match_job"("status");
        `,
      }),
    ).toEqual([
      "bad_concurrent_index uses CONCURRENTLY, which cannot run inside Prisma migrate deploy transactions.",
    ])

    expect(
      findDeployTransactionViolations({
        name: "bad_enum_use",
        sql: `
          ALTER TYPE "match_job_status" ADD VALUE 'expired';
          CREATE INDEX "mapper_match_job_expired_idx"
          ON "mapper_match_job"("queued_at")
          WHERE "status" = 'expired';
        `,
      }),
    ).toEqual([
      "bad_enum_use adds enum value 'expired' and references it again in the same migration; split dependent SQL into the next migration.",
    ])
  })

  it("ignores unsafe-looking migration text inside SQL comments", () => {
    expect(
      findDeployTransactionViolations({
        name: "comment_only",
        sql: `
          -- CREATE INDEX CONCURRENTLY would fail here if executed.
          ALTER TYPE "match_job_status" ADD VALUE 'archived';
          -- WHERE "status" = 'archived' belongs in a later migration.
        `,
      }),
    ).toEqual([])
  })

  it("keeps evidence internal and attached to jobs and candidates", () => {
    expect(schema).toContain("model MatchEvidence")
    expect(schema).toContain("internal    Boolean        @default(true)")
    expect(schema).toContain(
      "@relation(fields: [candidateId, jobId], references: [id, jobId]",
    )
    expect(schema).toContain("@@index([jobId, signal])")
    expect(schema).toContain("@@index([candidateId])")
  })

  it("can rerun an indexer version without duplicating timecoded signatures", () => {
    expect(schema).toContain('STRUCTURAL_HINT   @map("structural_hint")')
    expect(schema).toContain(
      '@@unique([coreId, videoVariantId, signatureType, algorithmVersion, offsetMilliseconds], map: "mapper_media_signature_variant_signature_key")',
    )
  })
})

interface MigrationSql {
  name: string
  sql: string
}

function findDeployTransactionViolations(migration: MigrationSql): string[] {
  const sql = stripSqlComments(migration.sql)
  const violations: string[] = []

  if (/\bCONCURRENTLY\b/i.test(sql)) {
    violations.push(
      `${migration.name} uses CONCURRENTLY, which cannot run inside Prisma migrate deploy transactions.`,
    )
  }

  const enumAdds = [...sql.matchAll(enumAddValueRegex)]
  const sqlWithoutEnumAddStatements = enumAdds.reduceRight(
    (remainingSql, match) =>
      `${remainingSql.slice(0, match.index)}${remainingSql.slice(
        (match.index ?? 0) + match[0].length,
      )}`,
    sql,
  )

  for (const match of enumAdds) {
    const enumValue = match.groups?.value
    if (!enumValue) continue

    if (quotedSqlLiteralRegex(enumValue).test(sqlWithoutEnumAddStatements)) {
      violations.push(
        `${migration.name} adds enum value '${enumValue}' and references it again in the same migration; split dependent SQL into the next migration.`,
      )
    }
  }

  return violations
}

const enumAddValueRegex =
  /\bALTER\s+TYPE\s+(?:"[^"]+"|[a-z_][\w$.]*)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'(?<value>(?:''|[^'])*)'/gi

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "")
}

function quotedSqlLiteralRegex(value: string): RegExp {
  return new RegExp(`'${escapeRegExp(value)}'`, "i")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
