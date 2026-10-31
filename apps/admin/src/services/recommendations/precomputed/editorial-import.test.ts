import { describe, expect, it, vi } from "vitest"
import {
  editorialImportManifest,
  executeEditorialImport,
  prepareEditorialImport,
} from "./editorial-import"

function fixture() {
  return {
    schemaVersion: "editorial-related-videos-v1",
    sourceGeneration: "existing-profile-generation",
    reviewBasis:
      "Catalogue descriptions and saved profiles; full videos not viewed.",
    records: Array.from({ length: 7 }, (_, i) => ({
      sourceVideoId: `video-${i}`,
      sourceTitle: `Video ${i}`,
      setRationale:
        "Explore complementary perspectives on this source's themes.",
      evidenceFlags: [] as string[],
      recommendations: Array.from({ length: 6 }, (_, j) => ({
        rank: j + 1,
        videoId: `video-${(i + j + 1) % 7}`,
        reason: "Offers a complementary perspective on the source's theme.",
      })),
    })),
  }
}
const options = {
  generationId: "editorial-test",
  inputCutoff: "2026-10-19T03:00:00.000Z",
}

describe("editorial saved-generation import", () => {
  it("bounds parallel reads and preserves source order when reads finish out of order", async () => {
    let active = 0
    let peak = 0
    const raw = fixture()
    const plan = await prepareEditorialImport({
      ...options,
      raw: JSON.stringify(raw),
      validate: async (source) => {
        peak = Math.max(peak, ++active)
        await new Promise((resolve) =>
          setTimeout(resolve, 7 - Number(source.split("-")[1])),
        )
        active--
        return null
      },
    })
    expect(peak).toBe(4)
    expect(plan.sources.map((source) => source.sourceVideoId)).toEqual(
      raw.records.map((source) => source.sourceVideoId),
    )
  })
  it("preserves ordered IDs and honest metadata provenance without model receipts", async () => {
    const raw = fixture()
    const plan = await prepareEditorialImport({
      ...options,
      raw: JSON.stringify(raw),
      validate: async () => null,
    })
    expect(plan.sources[0].choices.map((c) => c.targetVideoId)).toEqual(
      raw.records[0].recommendations.map((c) => c.videoId),
    )
    expect(plan.sources[0].choices[0]).toMatchObject({
      kind: "direct",
      evidence: { basis: "metadata", fields: ["title", "description"] },
    })
    expect(editorialImportManifest(plan)).toMatchObject({
      expectedSourceCount: 7,
      inputMode: "content_only",
      modelId: "codex-editorial-session",
    })
    const changed = structuredClone(plan)
    changed.sources[0].choices[0].reasonEnglish =
      "A different explanation of the connection."
    expect(editorialImportManifest(changed).inputDigest).not.toBe(
      editorialImportManifest(plan).inputDigest,
    )
  })

  it("records producer rejections, preserves relative order and closes rank gaps", async () => {
    const plan = await prepareEditorialImport({
      ...options,
      raw: JSON.stringify(fixture()),
      validate: async (source, choices) =>
        source === "video-0" &&
        choices.some((c) => c.targetVideoId === "video-2")
          ? "Duplicate Video content"
          : null,
    })
    expect(plan.sources[0].choices.map((c) => c.targetVideoId)).toEqual([
      "video-1",
      "video-3",
      "video-4",
      "video-5",
      "video-6",
    ])
    expect(plan.sources[0].choices.map((c) => c.rank)).toEqual([1, 2, 3, 4, 5])
    expect(plan.sources[0].exclusions).toEqual([
      { targetVideoId: "video-2", reason: "Duplicate Video content" },
    ])
  })

  it("retains unresolved sources in coverage with zero admitted choices", async () => {
    const raw = fixture()
    raw.records[0].evidenceFlags.push(
      "title-profile-mismatch-or-transcript-language-issue",
    )
    const plan = await prepareEditorialImport({
      ...options,
      raw: JSON.stringify(raw),
      validate: async () => null,
    })
    expect(plan.sources).toHaveLength(7)
    expect(plan.sources[0].choices).toEqual([])
    expect(plan.sources[0].exclusions).toHaveLength(6)
  })

  it("aborts before import when source coverage is invalid or validation infrastructure fails", async () => {
    const raw = fixture()
    raw.records[1].sourceVideoId = raw.records[0].sourceVideoId
    await expect(
      prepareEditorialImport({
        ...options,
        raw: JSON.stringify(raw),
        validate: async () => null,
      }),
    ).rejects.toThrow("Duplicate source")
    await expect(
      prepareEditorialImport({
        ...options,
        raw: JSON.stringify(fixture()),
        validate: async () => {
          throw new Error("DB unavailable")
        },
      }),
    ).rejects.toThrow("DB unavailable")
  })

  it("uses only start/source/complete and supports the producer's idempotent replay", async () => {
    const plan = await prepareEditorialImport({
      ...options,
      raw: JSON.stringify(fixture()),
      validate: async () => null,
    })
    const send = vi.fn(async () => ({ state: "complete", replay: true }))
    await executeEditorialImport(plan, send)
    await executeEditorialImport(plan, send)
    expect(send.mock.calls).toHaveLength(18)
    expect(send.mock.calls[0]).toEqual([editorialImportManifest(plan)])
    expect(send.mock.calls[8]).toEqual([
      { action: "complete", generationId: plan.generationId },
    ])
  })

  it("never completes an interrupted import or retries a failed write automatically", async () => {
    const plan = await prepareEditorialImport({
      ...options,
      raw: JSON.stringify(fixture()),
      validate: async () => null,
    })
    const actions: string[] = []
    await expect(
      executeEditorialImport(plan, async (payload) => {
        const input = payload as { action: string }
        actions.push(input.action)
        if (input.action === "source") throw new Error("write failed")
        return { state: "incomplete" }
      }),
    ).rejects.toThrow("write failed")
    expect(actions).not.toContain("complete")
    expect(actions.filter((action) => action === "source")).toHaveLength(4)
  })
})
