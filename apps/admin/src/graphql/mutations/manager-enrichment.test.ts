// Argument-pairing + dispatch-shape tests for the
// `triggerManagerEnrichment` mutation. Auth is enforced via Pothos
// scope-auth (covered exhaustively in
// src/auth/permissions.test.ts); these tests focus on argument
// validation + the resolver → service handoff.

import { beforeEach, describe, expect, it, vi } from "vitest"

const { triggerManagerEnrichmentMock } = vi.hoisted(() => ({
  triggerManagerEnrichmentMock: vi.fn(),
}))

vi.mock("@/services/manager-trigger.service", () => ({
  triggerManagerEnrichment: triggerManagerEnrichmentMock,
}))

import {
  dispatchManagerEnrichment,
  pairAndValidateArgs,
  ManagerEnrichmentArgsError,
} from "./manager-enrichment"

beforeEach(() => {
  triggerManagerEnrichmentMock.mockReset()
  triggerManagerEnrichmentMock.mockResolvedValue([])
})

describe("pairAndValidateArgs", () => {
  it("pairs assetIds and coreIds positionally", () => {
    const out = pairAndValidateArgs({
      assetIds: [1, 2, 3],
      coreIds: ["c-1", "c-2", "c-3"],
      kind: "scene-analysis",
    })
    expect(out).toEqual({
      kind: "scene-analysis",
      items: [
        { assetId: 1, coreId: "c-1" },
        { assetId: 2, coreId: "c-2" },
        { assetId: 3, coreId: "c-3" },
      ],
    })
  })

  it("accepts kind=transcript", () => {
    const out = pairAndValidateArgs({
      assetIds: [1],
      coreIds: ["c-1"],
      kind: "transcript",
    })
    expect(out.kind).toBe("transcript")
  })

  it.each([
    "bogus",
    "",
    "scene_analysis", // underscore not hyphen — strict
    "SCENE-ANALYSIS",
  ])("rejects kind=%s", (kind) => {
    expect(() =>
      pairAndValidateArgs({
        assetIds: [1],
        coreIds: ["c-1"],
        kind,
      }),
    ).toThrow(ManagerEnrichmentArgsError)
  })

  it("rejects empty assetIds", () => {
    expect(() =>
      pairAndValidateArgs({ assetIds: [], coreIds: [], kind: "transcript" }),
    ).toThrow(/empty/i)
  })

  it("rejects mismatched lengths", () => {
    expect(() =>
      pairAndValidateArgs({
        assetIds: [1, 2],
        coreIds: ["c-1"],
        kind: "transcript",
      }),
    ).toThrow(/same length/i)
  })

  it("rejects > 100 items", () => {
    const assetIds = Array.from({ length: 101 }, (_, i) => i + 1)
    const coreIds = assetIds.map((id) => `c-${id}`)
    expect(() =>
      pairAndValidateArgs({ assetIds, coreIds, kind: "transcript" }),
    ).toThrow(/100/i)
  })

  it("rejects zero / negative assetIds", () => {
    expect(() =>
      pairAndValidateArgs({
        assetIds: [0],
        coreIds: ["c-1"],
        kind: "transcript",
      }),
    ).toThrow(/positive/i)
    expect(() =>
      pairAndValidateArgs({
        assetIds: [-3],
        coreIds: ["c-1"],
        kind: "transcript",
      }),
    ).toThrow(/positive/i)
  })

  it("rejects empty coreId entries", () => {
    expect(() =>
      pairAndValidateArgs({
        assetIds: [1],
        coreIds: [""],
        kind: "transcript",
      }),
    ).toThrow(/non-empty strings/i)
  })

  it("rejects non-integer assetIds", () => {
    expect(() =>
      pairAndValidateArgs({
        assetIds: [1.5],
        coreIds: ["c-1"],
        kind: "transcript",
      }),
    ).toThrow(/positive/i)
  })
})

describe("dispatchManagerEnrichment", () => {
  it("forwards paired items to the service with the parsed kind", async () => {
    triggerManagerEnrichmentMock.mockResolvedValueOnce([
      {
        assetId: 1,
        coreId: "c-1",
        managerJobId: "j-1",
        status: "STARTED",
      },
    ])

    const result = await dispatchManagerEnrichment({
      assetIds: [1, 2],
      coreIds: ["c-1", "c-2"],
      kind: "scene-analysis",
    })

    expect(triggerManagerEnrichmentMock).toHaveBeenCalledOnce()
    expect(triggerManagerEnrichmentMock).toHaveBeenCalledWith(
      [
        { assetId: 1, coreId: "c-1" },
        { assetId: 2, coreId: "c-2" },
      ],
      "scene-analysis",
    )
    expect(result).toHaveLength(1)
  })

  it("propagates ManagerEnrichmentArgsError without invoking the service", async () => {
    await expect(
      dispatchManagerEnrichment({
        assetIds: [1],
        coreIds: [],
        kind: "scene-analysis",
      }),
    ).rejects.toBeInstanceOf(ManagerEnrichmentArgsError)
    expect(triggerManagerEnrichmentMock).not.toHaveBeenCalled()
  })

  it("propagates service failure verbatim", async () => {
    const boom = new Error("service blew up")
    triggerManagerEnrichmentMock.mockRejectedValueOnce(boom)
    await expect(
      dispatchManagerEnrichment({
        assetIds: [1],
        coreIds: ["c-1"],
        kind: "transcript",
      }),
    ).rejects.toBe(boom)
  })
})
