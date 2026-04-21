import { describe, expect, it } from "vitest"

import {
  buildAutomationKey,
  selectEligibleAutomationVideos,
} from "./eligibility"

describe("selectEligibleAutomationVideos", () => {
  it("selects missing target subtitles, caps the cycle, and skips duplicate work", () => {
    const duplicateKey = buildAutomationKey({
      template: "target_subtitles_missing",
      videoDocumentId: "video-2",
      targetLanguageIds: ["529"],
    })

    const result = selectEligibleAutomationVideos(
      [
        {
          documentId: "video-1",
          coreId: "core-1",
          muxAssetId: "asset-1",
          muxPlaybackId: "playback-1",
          outputOwner: "missing",
        },
        {
          documentId: "video-2",
          coreId: "core-2",
          muxAssetId: "asset-2",
          muxPlaybackId: "playback-2",
          outputOwner: "missing",
        },
        {
          documentId: "video-3",
          coreId: "core-3",
          muxAssetId: "asset-3",
          muxPlaybackId: "playback-3",
          outputOwner: "missing",
        },
      ],
      {
        template: "target_subtitles_missing",
        refreshMode: "missing_only",
        targetLanguageIds: ["529"],
        maxVideosPerRun: 1,
        runningAutomationKeys: new Set([duplicateKey]),
      },
    )

    expect(result.eligibleCount).toBe(2)
    expect(result.skippedDuplicateCount).toBe(1)
    expect(result.selected.map((video) => video.documentId)).toEqual([
      "video-1",
    ])
  })

  it("includes AI-owned outputs in refresh mode and excludes human-owned outputs", () => {
    const result = selectEligibleAutomationVideos(
      [
        {
          documentId: "missing",
          coreId: "core-1",
          muxAssetId: "asset-1",
          muxPlaybackId: "playback-1",
          outputOwner: "missing",
        },
        {
          documentId: "ai",
          coreId: "core-2",
          muxAssetId: "asset-2",
          muxPlaybackId: "playback-2",
          outputOwner: "ai",
        },
        {
          documentId: "human",
          coreId: "core-3",
          muxAssetId: "asset-3",
          muxPlaybackId: "playback-3",
          outputOwner: "human",
        },
      ],
      {
        template: "metadata_missing",
        refreshMode: "refresh_ai_generated",
        targetLanguageIds: [],
        maxVideosPerRun: 10,
        runningAutomationKeys: new Set(),
      },
    )

    expect(result.selected.map((video) => video.documentId)).toEqual([
      "missing",
      "ai",
    ])
  })

  it("returns no target subtitle candidates for invalid stored language counts", () => {
    const candidates = [
      {
        documentId: "video-1",
        coreId: "core-1",
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        outputOwner: "missing" as const,
      },
    ]

    expect(
      selectEligibleAutomationVideos(candidates, {
        template: "target_subtitles_missing",
        refreshMode: "missing_only",
        targetLanguageIds: [],
        maxVideosPerRun: 1,
        runningAutomationKeys: new Set(),
      }),
    ).toMatchObject({
      eligibleCount: 0,
      skippedDuplicateCount: 0,
      selected: [],
    })

    expect(
      selectEligibleAutomationVideos(candidates, {
        template: "target_subtitles_missing",
        refreshMode: "missing_only",
        targetLanguageIds: ["529", "6414"],
        maxVideosPerRun: 1,
        runningAutomationKeys: new Set(),
      }),
    ).toMatchObject({
      eligibleCount: 0,
      skippedDuplicateCount: 0,
      selected: [],
    })
  })
})
