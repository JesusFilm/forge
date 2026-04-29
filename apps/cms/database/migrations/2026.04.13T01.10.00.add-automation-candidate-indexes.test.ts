import { describe, expect, it, vi } from "vitest"

import {
  down,
  up,
} from "./2026.04.13T01.10.00.add-automation-candidate-indexes"

function buildKnex() {
  return {
    schema: {
      hasTable: vi.fn().mockResolvedValue(true),
    },
    raw: vi.fn().mockResolvedValue({ rowCount: 1 }),
  }
}

describe("add automation candidate indexes migration", () => {
  it("adds indexes for automation candidate filtering and ordering", async () => {
    const knex = buildKnex()

    await up(knex)

    const statements = knex.raw.mock.calls.map(([sql]) => sql).join("\n")
    expect(statements).toContain("idx_videos_automation_candidates_title")
    expect(statements).toContain("idx_videos_automation_metadata_missing_title")
    expect(statements).toContain("idx_videos_automation_metadata_refresh_title")
    expect(statements).toContain("idx_video_subtitles_automation_published")
    expect(statements).toContain('"title" ASC NULLS LAST, "document_id"')
    expect(statements).toContain('"ai_metadata" IS DISTINCT FROM FALSE')
  })

  it("drops automation candidate indexes on rollback", async () => {
    const knex = buildKnex()

    await down(knex)

    const statements = knex.raw.mock.calls.map(([sql]) => sql)
    expect(statements).toEqual([
      "DROP INDEX IF EXISTS idx_videos_automation_candidates_title",
      "DROP INDEX IF EXISTS idx_videos_automation_metadata_missing_title",
      "DROP INDEX IF EXISTS idx_videos_automation_metadata_refresh_title",
      "DROP INDEX IF EXISTS idx_video_subtitles_automation_published",
    ])
  })
})
