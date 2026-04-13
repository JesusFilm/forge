import { describe, expect, it, vi } from "vitest"

import { queryVideoCoverage } from "./video-coverage"

describe("queryVideoCoverage", () => {
  it("supports an automation projection that omits dashboard-only fields", async () => {
    const knex = {
      raw: vi.fn().mockResolvedValue({
        rows: [
          {
            document_id: "video-1",
            core_id: "core-1",
            label: "featureFilm",
            ai_metadata: null,
            sub_human: 0,
            sub_ai: 1,
            aud_human: 0,
            aud_ai: 0,
            title: "Ignored title",
            slug: "ignored-slug",
            image_url: "https://example.test/ignored/public",
            parent_document_ids: ["ignored-parent"],
          },
        ],
      }),
    }

    const result = await queryVideoCoverage(knex, ["529"], {
      mode: "automation",
    })

    expect(knex.raw).toHaveBeenCalledWith(
      expect.stringContaining("l.core_id = ANY(?)"),
      [["529"], ["529"]],
    )
    expect(result).toEqual([
      {
        documentId: "video-1",
        coreId: "core-1",
        label: "featureFilm",
        aiMetadata: null,
        coverage: {
          subtitles: { human: 0, ai: 1 },
          audio: { human: 0, ai: 0 },
        },
      },
    ])
  })
})
