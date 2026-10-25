import { describe, expect, it } from "vitest"
import type { Prisma } from "@prisma/client"
import {
  servedSnapshotCreate,
  servedSnapshotValue,
} from "./served-item-payload"
import {
  input,
  makeHarness,
  personalizedInput,
  semanticCandidates,
} from "./delivery.service.test-helpers"
import { userDeliveryHarness } from "./user-delivery.service.test-helpers"
import { safeShadowLiveItem } from "./shadow-evaluation/projection"

type PackedRequest = {
  servedItemPayload: {
    version: number
    items: Record<
      string,
      {
        presentation: { videoSlug: string }
        candidateProvenance: { sources: unknown[] }
      }
    >
  }
  items: {
    create: Array<{
      id: string
      presentation: unknown
      candidateProvenance: unknown
      expiresAt: Date
    }>
  }
  expiresAt: Date
}

describe("served item snapshots", () => {
  it("round trips full JSON values without touching item identity or expiry", () => {
    const row = {
      id: "item-1",
      requestId: "request-1",
      capabilityJti: "capability-1",
      expiresAt: new Date("2026-10-29T00:00:00.000Z"),
      presentation: { title: "A", themes: ["x"], empty: null },
      candidateProvenance: { sources: [{ score: 0.75 }], note: null },
    }
    const second = { ...row, id: "item-2" }
    const packed = servedSnapshotCreate([row, second], "packed")
    expect(packed.items.create[0]).toMatchObject({
      id: row.id,
      requestId: row.requestId,
      capabilityJti: row.capabilityJti,
      expiresAt: row.expiresAt,
      presentation: {},
      candidateProvenance: {},
    })
    expect(
      servedSnapshotValue(
        JSON.parse(
          JSON.stringify(packed.servedItemPayload),
        ) as Prisma.JsonValue,
        packed.items.create[0],
      ),
    ).toEqual(row)
    expect(servedSnapshotValue(null, row)).toEqual(row)
  })

  it("keeps one-item slates inline even when packed writing is enabled", () => {
    const row = {
      id: "one",
      presentation: { title: "one" },
      candidateProvenance: {},
    }
    expect(servedSnapshotCreate([row], "packed")).toEqual({
      items: { create: [row] },
    })
  })

  it("fails closed for unknown versions and missing item keys", () => {
    const row = { id: "one", presentation: {}, candidateProvenance: {} }
    expect(() => servedSnapshotValue({ version: 2, items: {} }, row)).toThrow()
    expect(() => servedSnapshotValue({ version: 1, items: {} }, row)).toThrow()
  })

  it("gives shadow projection the same input in both formats", () => {
    const item = {
      id: "item",
      targetMediaId: "video",
      position: 0,
      presentation: {
        videoSlug: "video",
        videoTitle: "Title",
        audioLanguageSlug: "english",
        themes: ["hope"],
        startSeconds: 3,
      },
      candidateProvenance: { source: "semantic" },
    }
    const packed = servedSnapshotCreate(
      [item, { ...item, id: "second" }],
      "packed",
    )
    expect(
      safeShadowLiveItem(
        servedSnapshotValue(
          JSON.parse(
            JSON.stringify(packed.servedItemPayload),
          ) as Prisma.JsonValue,
          packed.items.create[0],
        ),
        "en",
      ),
    ).toEqual(safeShadowLiveItem(item, "en"))
  })

  it("packs the actual seeded delivery writer only when enabled", async () => {
    const h = makeHarness({ servedItemFormat: "packed" })
    h.retrieve.mockResolvedValue(semanticCandidates(2))
    const response = await h.service.deliver(input("packed-seed"))
    expect(response.result).toBe("served")
    const data = h.tx.recommendationRequest.create.mock.calls[0]![0]
      .data as PackedRequest
    const row = data.items.create[0]
    expect(data.servedItemPayload.items[row.id].presentation.videoSlug).toBe(
      "semantic-video-1",
    )
    expect(
      data.servedItemPayload.items[row.id].candidateProvenance.sources,
    ).toHaveLength(1)
    expect(row.presentation).toEqual({})
    expect(row.candidateProvenance).toEqual({})
    expect(row.expiresAt).toEqual(data.expiresAt)
  })

  it("packs the actual For You writer only when enabled", async () => {
    const h = userDeliveryHarness(2, undefined, "packed")
    const response = await h.service.deliver(personalizedInput())
    expect(response.result).toBe("served")
    const data = h.tx.recommendationRequest.create.mock.calls[0]![0]
      .data as PackedRequest
    expect(data.servedItemPayload.version).toBe(1)
    expect(Object.keys(data.servedItemPayload.items)).toHaveLength(
      response.items.length,
    )
    for (const row of data.items.create) {
      expect(row.presentation).toEqual({})
      expect(row.candidateProvenance).toEqual({})
      expect(
        data.servedItemPayload.items[row.id].presentation.videoSlug,
      ).toBeTruthy()
      expect(row.expiresAt).toEqual(data.expiresAt)
    }
  })
})
