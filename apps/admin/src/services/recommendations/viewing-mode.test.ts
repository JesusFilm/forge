import { describe, expect, it } from "vitest"
import {
  summarizeViewingMode,
  viewingModePreference,
  VIEWING_MODE_VERSION,
} from "./viewing-mode"

const start = new Date("2026-09-16T00:00:00Z")
function fact(
  end: number,
  from: number,
  to: number,
  mode: "sound_off" | "sound_on" = "sound_off",
  durationSeconds: number | null = 120,
) {
  return {
    kind: "playback_viewing_mode",
    occurredAt: new Date(start.getTime() + end * 1_000),
    payload: {
      version: VIEWING_MODE_VERSION,
      mode,
      preview: true,
      activeMilliseconds: (to - from) * 1_000,
      fromSeconds: from,
      toSeconds: to,
      durationSeconds,
      playbackRate: 1,
    },
  }
}

describe("viewing mode behavioral profile", () => {
  it.each(["sound_off", "sound_on"] as const)(
    "qualifies %s viewing with the same progress and time requirements",
    (mode) => {
      const result = summarizeViewingMode(
        [fact(10, 0, 10, mode), fact(20, 10, 20, mode), fact(30, 20, 30, mode)],
        start,
      )
      expect(
        mode === "sound_off"
          ? result.soundOffQualified
          : result.soundOnQualified,
      ).toBe(true)
      expect(result.previewMilliseconds).toBe(30_000)
    },
  )

  it("does not qualify repeated short preview loops as watching the video", () => {
    const result = summarizeViewingMode(
      Array.from({ length: 10 }, (_, i) => fact((i + 1) * 3, 0, 3)),
      start,
    )
    expect(result.soundOffMilliseconds).toBe(30_000)
    expect(result.soundOffProgressSeconds).toBe(3)
    expect(result.soundOffQualified).toBe(false)
  })

  it("deduplicates overlapping and replayed intervals, including across modes", () => {
    const result = summarizeViewingMode(
      [fact(10, 0, 10), fact(10, 0, 10), fact(15, 5, 15, "sound_on")],
      start,
    )
    expect(result.soundOffMilliseconds).toBe(10_000)
    expect(result.soundOnMilliseconds).toBe(5_000)
    expect(result.soundOnProgressSeconds).toBe(5)
  })

  it("clips pre-claim evidence and requires actual progression", () => {
    const result = summarizeViewingMode(
      [fact(2, 0, 10), fact(8, 40, 40)],
      start,
    )
    expect(result.soundOffMilliseconds).toBe(2_000)
    expect(result.soundOffProgressSeconds).toBe(2)
    expect(result.soundOffQualified).toBe(false)
  })

  it("scales qualification to short videos and requires 30 seconds when duration is unknown", () => {
    expect(
      summarizeViewingMode([fact(5, 0, 5, "sound_off", 20)], start)
        .soundOffQualified,
    ).toBe(true)
    expect(
      summarizeViewingMode([fact(5, 0, 5, "sound_off", null)], start)
        .soundOffQualified,
    ).toBe(false)
  })

  it("leaves missing, invalid and immediate-exit evidence unknown", () => {
    expect(summarizeViewingMode([], start).soundOffQualified).toBe(false)
    const invalid = fact(30, 0, 30)
    invalid.payload.version = "unsupported" as typeof VIEWING_MODE_VERSION
    expect(summarizeViewingMode([invalid], start).soundOffMilliseconds).toBe(0)
    const result = summarizeViewingMode([fact(1, 0, 1)], start)
    expect(
      viewingModePreference([{ ...result, mediaId: "short-exit" }])
        .qualifiedVideos,
    ).toBe(0)
  })

  it("learns from distinct videos without multiplying repeated views", () => {
    const off = summarizeViewingMode([fact(30, 0, 30)], start)
    const on = summarizeViewingMode([fact(30, 0, 30, "sound_on")], start)
    const result = viewingModePreference([
      ...Array.from({ length: 20 }, () => ({ ...off, mediaId: "one" })),
      { ...on, mediaId: "two" },
    ])
    expect(result).toEqual({
      qualifiedVideos: 2,
      confidence: 2 / 3,
      soundOffPreference: 0.5,
    })
  })
})
