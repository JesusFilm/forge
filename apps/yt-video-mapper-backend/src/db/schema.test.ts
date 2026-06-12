import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const schema = readFileSync(
  new URL("../../prisma/schema.prisma", import.meta.url),
  "utf8",
)

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
