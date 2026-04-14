import { describe, expect, it, vi } from "vitest"

import { queryAutomationCandidates } from "./automation-candidates"

describe("queryAutomationCandidates", () => {
  it("uses a narrow metadata query with scalar duplicate suppression", async () => {
    const knex = {
      raw: vi.fn().mockResolvedValue({
        rows: [
          {
            document_id: "video-1",
            core_id: "core-1",
            output_owner: "missing",
            eligible_count: 2,
            skipped_duplicate_count: 1,
          },
        ],
      }),
    }

    const result = await queryAutomationCandidates(knex, {
      template: "metadata_missing",
      refreshMode: "missing_only",
      targetLanguageIds: [],
      limit: 1,
    })

    const [sql, bindings] = knex.raw.mock.calls[0] ?? []
    expect(sql).toContain("automation_key")
    expect(sql).toContain("v.ai_metadata")
    expect(sql).not.toContain("variant_per_lang")
    expect(sql).not.toContain("parent_links")
    expect(bindings).toEqual(["metadata_missing", "source", 1])
    expect(result).toEqual({
      eligibleCount: 2,
      skippedDuplicateCount: 1,
      candidates: [
        {
          documentId: "video-1",
          coreId: "core-1",
          outputOwner: "missing",
        },
      ],
    })
  })

  it("uses target-language subtitle ownership instead of dashboard aggregate CTEs", async () => {
    const knex = {
      raw: vi.fn().mockResolvedValue({
        rows: [
          {
            document_id: "video-2",
            core_id: "core-2",
            output_owner: "ai",
            eligible_count: 1,
            skipped_duplicate_count: 0,
          },
        ],
      }),
    }

    await queryAutomationCandidates(knex, {
      template: "target_subtitles_missing",
      refreshMode: "refresh_ai_generated",
      targetLanguageIds: ["529"],
      limit: 10,
    })

    const [sql, bindings] = knex.raw.mock.calls[0] ?? []
    expect(sql).toContain("subtitle_ownership AS")
    expect(sql).toContain(
      "LEFT JOIN subtitle_ownership so ON so.video_id = v.id",
    )
    expect(sql).toContain("l.core_id = ANY(?)")
    expect(sql).not.toContain("EXISTS")
    expect(sql).not.toContain("subtitle_per_lang")
    expect(sql).not.toContain("variant_per_lang")
    expect(bindings).toEqual([["529"], "target_subtitles_missing", "529", 10])
  })

  it("keeps capped selection in dashboard title order", async () => {
    const knex = {
      raw: vi.fn().mockResolvedValue({ rows: [] }),
    }

    await queryAutomationCandidates(knex, {
      template: "metadata_missing",
      refreshMode: "missing_only",
      targetLanguageIds: [],
      limit: 10,
    })

    const [sql] = knex.raw.mock.calls[0] ?? []
    expect(sql).toContain("ORDER BY sort_title NULLS LAST, document_id")
    expect(sql).toContain(
      "ORDER BY selected.sort_title NULLS LAST, selected.document_id",
    )
  })

  it("preserves counts when every eligible candidate is already running", async () => {
    const knex = {
      raw: vi.fn().mockResolvedValue({
        rows: [
          {
            document_id: null,
            core_id: null,
            output_owner: null,
            eligible_count: 0,
            skipped_duplicate_count: 2,
          },
        ],
      }),
    }

    const result = await queryAutomationCandidates(knex, {
      template: "metadata_missing",
      refreshMode: "missing_only",
      targetLanguageIds: [],
      limit: 1,
    })

    expect(result).toEqual({
      eligibleCount: 0,
      skippedDuplicateCount: 2,
      candidates: [],
    })
  })
})
