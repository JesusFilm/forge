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
      'videoVariantId         String          @unique @map("video_variant_id")',
    )
  })

  it("allows multiple ranked variants under the same coreId for one job", () => {
    expect(schema).toContain("@@unique([jobId, rank])")
    expect(schema).toContain("@@unique([jobId, videoVariantId])")
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
    expect(schema).toContain(
      "@@unique([videoVariantId, signatureType, algorithmVersion, offsetMilliseconds])",
    )
  })
})
