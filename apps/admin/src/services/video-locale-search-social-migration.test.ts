import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const migrationSql = readFileSync(
  resolve(
    __dirname,
    "..",
    "..",
    "prisma",
    "migrations",
    "0047_video_locale_search_social_metadata",
    "migration.sql",
  ),
  "utf8",
)

describe("VideoLocale Search and Social metadata migration", () => {
  it("adds nullable text overlays and a restrictive managed-media relation", () => {
    expect(migrationSql).toMatch(/ADD COLUMN "search_title" TEXT/)
    expect(migrationSql).toMatch(/ADD COLUMN "search_description" TEXT/)
    expect(migrationSql).toMatch(/ADD COLUMN "social_image_asset_id" TEXT/)
    expect(migrationSql).toContain(
      'CREATE INDEX "video_locale_social_image_asset_id_idx"',
    )
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("social_image_asset_id"\) REFERENCES "media_asset"\("id"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/,
    )
  })

  it("bounds schema-lock acquisition", () => {
    expect(migrationSql).toMatch(/SET lock_timeout = '5s'/)
    expect(migrationSql).toMatch(/RESET lock_timeout/)
  })

  it("targets only the active English JESUS locale by stable identities", () => {
    expect(migrationSql).toContain("v.\"core_id\" = '1_jf-0-0'")
    expect(migrationSql).toContain("v.\"slug\" = 'jesus'")
    expect(migrationSql).toContain("vl.\"language_core_id\" = '529'")
    expect(migrationSql).toContain('v."deleted_at" IS NULL')
    expect(migrationSql).toContain('vl."deleted_at" IS NULL')
  })

  it("seeds the exact approved copy without selecting an image", () => {
    expect(migrationSql).toContain(
      "Watch JESUS — Full Movie Free Online | Jesus Film Project",
    )
    expect(migrationSql).toContain(
      "Watch the JESUS film free online. Follow his life, teachings, miracles, death, and resurrection through the Gospel of Luke in more than 2,000 languages.",
    )
    expect(migrationSql).toMatch(/"social_image_asset_id" = NULL/)
  })

  it("no-ops for zero candidates and aborts before update for duplicates", () => {
    expect(migrationSql).toMatch(
      /IF candidate_count > 1 THEN[\s\S]*RAISE EXCEPTION[\s\S]*ELSIF candidate_count = 1 THEN[\s\S]*UPDATE "video_locale"/,
    )
    expect(migrationSql).not.toMatch(/ELSE\s+UPDATE "video_locale"/)
  })
})
