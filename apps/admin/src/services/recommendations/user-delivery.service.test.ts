import { afterEach, describe, expect, it, vi } from "vitest"
import { personalizedInput } from "./delivery.service.test-helpers"
import {
  userDeliveryHarness as harness,
  video,
} from "./user-delivery.service.test-helpers"

describe("content-only source-free recommendations", () => {
  afterEach(() => vi.useRealTimers())

  it.each([0, 1, 6])(
    "serves only editorial metadata pools with %i old profile candidates",
    async (count) => {
      const h = harness(count)
      const result = await h.service.deliver(personalizedInput())
      expect(result).toMatchObject({
        result: "served",
        profileCount: 0,
        curatedCount: 6,
        cohort: "cold_start",
      })
      expect(result.items).toHaveLength(6)
      expect(result.items.every((item) => item.generator === "curated")).toBe(
        true,
      )
      expect(result.items[0]).not.toHaveProperty("embeddingText")
      expect(h.authorizeProfile).not.toHaveBeenCalled()
      expect(h.retrieveProfile).not.toHaveBeenCalled()
      expect(h.history).not.toHaveBeenCalled()
      expect(h.curated).toHaveBeenCalledWith(
        expect.objectContaining({
          interestVideoIds: [],
          audioLanguageSlug: "english",
        }),
      )
    },
  )

  it("does not depend on a stalled retired history provider", async () => {
    const h = harness(6)
    h.history.mockImplementation(() => new Promise(() => {}))
    expect((await h.service.deliver(personalizedInput())).result).toBe("served")
    expect(h.history).not.toHaveBeenCalled()
  })

  it("bounds pending issuance without exposing capabilities", async () => {
    vi.useFakeTimers()
    const h = harness(0)
    h.tx.recommendationRequest.create.mockImplementation(
      () => new Promise(() => {}),
    )
    const pending = h.service.deliver(personalizedInput())
    await vi.advanceTimersByTimeAsync(1500)
    expect(await pending).toMatchObject({
      result: "unavailable",
      reason: "delivery_timeout",
      items: [],
    })
  })
  it("does not read profile/history without valid authority", async () => {
    const h = harness(6)
    h.authorizeProfile.mockResolvedValue(false)
    expect(await h.service.deliver(personalizedInput())).toMatchObject({
      result: "served",
      curatedCount: 6,
    })
    expect(h.retrieveProfile).not.toHaveBeenCalled()
    expect(h.history).not.toHaveBeenCalled()
  })
  it("reports insufficient coverage without publishing an undersized or wrong-language slate", async () => {
    const h = harness(0)
    h.curated.mockResolvedValue({ version: "v1", items: [video(1)] })
    expect(await h.service.deliver(personalizedInput())).toMatchObject({
      result: "unavailable",
      reason: "coverage_unavailable",
      items: [],
    })
    expect(h.tx.recommendationRequest.create).not.toHaveBeenCalled()
  })
  it("never exposes capabilities when persistence fails", async () => {
    const h = harness(6)
    h.tx.recommendationRequest.create.mockRejectedValue(new Error("db down"))
    expect(await h.service.deliver(personalizedInput())).toMatchObject({
      result: "unavailable",
      items: [],
    })
    expect(h.release).toHaveBeenCalledOnce()
  })
  it.each([0, 21, 1.5])("rejects count %i before admission", async (count) => {
    const h = harness(0)
    expect(
      await h.service.deliver({ ...personalizedInput(), count }),
    ).toMatchObject({ reason: "invalid_input" })
    expect(h.acquire).not.toHaveBeenCalled()
  })
})
