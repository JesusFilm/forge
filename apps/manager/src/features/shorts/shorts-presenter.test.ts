import { describe, expect, it } from "vitest"
import type { JobRecord, ShortsPhase } from "@/types/job"
import {
  buildSourceWatchHref,
  buildShortsCloneHref,
  buildShortsMediaHref,
  canDownloadShortsOutput,
  formatClipInput,
  formatClipRange,
  formatClipTime,
  formatShortsAnnotation,
  formatShortsPhase,
  getShortsJobSummary,
  isActiveShortsPhase,
  isEditorShortsPhase,
  isShortsDraftStale,
  isShortsLaunchFailed,
  parseClipTime,
  shortsPhaseTone,
  validateClipSelection,
} from "./shorts-presenter"

const ALL_PHASES: ShortsPhase[] = [
  "queued",
  "preparing",
  "ready_for_review",
  "rendering",
  "mux_processing",
  "completed",
  "prepare_failed",
  "render_failed",
]

describe("formatClipTime", () => {
  it("formats mm:ss", () => {
    expect(formatClipTime(0)).toBe("0:00")
    expect(formatClipTime(5)).toBe("0:05")
    expect(formatClipTime(65)).toBe("1:05")
    expect(formatClipTime(600)).toBe("10:00")
  })

  it("floors fractional seconds", () => {
    expect(formatClipTime(12.9)).toBe("0:12")
  })

  it("formats h:mm:ss above one hour", () => {
    expect(formatClipTime(3600)).toBe("1:00:00")
    expect(formatClipTime(3725)).toBe("1:02:05")
  })

  it("clamps negatives to zero", () => {
    expect(formatClipTime(-3)).toBe("0:00")
  })
})

describe("formatClipInput", () => {
  it("keeps tenths of a second", () => {
    expect(formatClipInput(65.5)).toBe("1:05.5")
    expect(formatClipInput(65)).toBe("1:05")
    expect(formatClipInput(0.25)).toBe("0:00.3")
  })

  it("carries tenths that round to a whole second", () => {
    expect(formatClipInput(64.96)).toBe("1:05")
  })

  it("round-trips through parseClipTime", () => {
    for (const seconds of [0, 5.5, 65.5, 120.9]) {
      expect(parseClipTime(formatClipInput(seconds))).toBe(seconds)
    }
  })
})

describe("formatClipRange", () => {
  it("formats start–end", () => {
    expect(formatClipRange({ startSec: 65, endSec: 95 })).toBe("1:05–1:35")
  })
})

describe("parseClipTime", () => {
  it("parses bare seconds", () => {
    expect(parseClipTime("42")).toBe(42)
    expect(parseClipTime("42.5")).toBe(42.5)
  })

  it("parses mm:ss", () => {
    expect(parseClipTime("1:05")).toBe(65)
    expect(parseClipTime("10:00")).toBe(600)
    expect(parseClipTime("0:07.5")).toBe(7.5)
  })

  it("parses h:mm:ss", () => {
    expect(parseClipTime("1:02:05")).toBe(3725)
  })

  it("round-trips formatClipTime output", () => {
    for (const seconds of [0, 5, 65, 600, 3725]) {
      expect(parseClipTime(formatClipTime(seconds))).toBe(seconds)
    }
  })

  it("rejects malformed values", () => {
    expect(parseClipTime("")).toBeNull()
    expect(parseClipTime("abc")).toBeNull()
    expect(parseClipTime("1:99")).toBeNull()
    expect(parseClipTime("-1:05")).toBeNull()
    expect(parseClipTime("1:2:3:4")).toBeNull()
    expect(parseClipTime("1.5:00")).toBeNull()
  })
})

describe("validateClipSelection", () => {
  it("accepts a valid clip", () => {
    expect(
      validateClipSelection({ startSec: 10, endSec: 40, durationSec: 120 }),
    ).toEqual({ ok: true })
  })

  it("rejects inverted bounds as clip_out_of_bounds", () => {
    const result = validateClipSelection({
      startSec: 40,
      endSec: 10,
      durationSec: 120,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("clip_out_of_bounds")
  })

  it("mirrors the server's clip_too_short reason below 5s", () => {
    const result = validateClipSelection({
      startSec: 0,
      endSec: 4.5,
      durationSec: 120,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("clip_too_short")
  })

  it("mirrors the server's clip_too_long reason above 180s", () => {
    const result = validateClipSelection({
      startSec: 0,
      endSec: 181,
      durationSec: 600,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("clip_too_long")
  })

  it("mirrors the server's clip_out_of_bounds reason past the duration", () => {
    const result = validateClipSelection({
      startSec: 100,
      endSec: 130,
      durationSec: 120,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("clip_out_of_bounds")
  })

  it("allows the server's 0.5s end tolerance", () => {
    expect(
      validateClipSelection({
        startSec: 100,
        endSec: 120.4,
        durationSec: 120,
      }),
    ).toEqual({ ok: true })
  })

  it("skips the bounds check when the duration is unknown", () => {
    expect(
      validateClipSelection({ startSec: 0, endSec: 30, durationSec: null }),
    ).toEqual({ ok: true })
  })
})

describe("isShortsDraftStale", () => {
  it("is false before any render", () => {
    expect(
      isShortsDraftStale({ draftVersion: 3, lastRenderedDraftVersion: null }),
    ).toBe(false)
    expect(isShortsDraftStale(null)).toBe(false)
  })

  it("is true when the draft moved past the last render", () => {
    expect(
      isShortsDraftStale({ draftVersion: 4, lastRenderedDraftVersion: 3 }),
    ).toBe(true)
  })

  it("is false when the last render matches the draft", () => {
    expect(
      isShortsDraftStale({ draftVersion: 3, lastRenderedDraftVersion: 3 }),
    ).toBe(false)
  })
})

describe("phase presentation", () => {
  it("labels every phase", () => {
    for (const phase of ALL_PHASES) {
      expect(formatShortsPhase(phase).length).toBeGreaterThan(0)
    }
  })

  it("maps phases to tones", () => {
    expect(shortsPhaseTone("completed")).toBe("completed")
    expect(shortsPhaseTone("prepare_failed")).toBe("failed")
    expect(shortsPhaseTone("render_failed")).toBe("failed")
    expect(shortsPhaseTone("rendering")).toBe("running")
    expect(shortsPhaseTone("ready_for_review")).toBe("pending")
  })

  it("marks exactly the workflow-running phases active", () => {
    const active = ALL_PHASES.filter(isActiveShortsPhase)
    expect(active).toEqual([
      "queued",
      "preparing",
      "rendering",
      "mux_processing",
    ])
  })

  it("marks the reviewable phases as editor phases", () => {
    const editor = ALL_PHASES.filter(isEditorShortsPhase)
    expect(editor).toEqual(["ready_for_review", "completed", "render_failed"])
  })

  it("detects launch failure only for queued + failed", () => {
    expect(isShortsLaunchFailed("queued", "failed")).toBe(true)
    expect(isShortsLaunchFailed("queued", "pending")).toBe(false)
    expect(isShortsLaunchFailed("queued", "running")).toBe(false)
    expect(isShortsLaunchFailed("preparing", "failed")).toBe(false)
    expect(isShortsLaunchFailed("prepare_failed", "failed")).toBe(false)
  })
})

describe("formatShortsAnnotation", () => {
  it("maps the worker literals to operator copy", () => {
    expect(formatShortsAnnotation("transcription_skipped_no_audio")).toBe(
      "Captions skipped: no audio",
    )
    expect(formatShortsAnnotation("transcription_unsupported_language")).toBe(
      "Captions skipped: unsupported language",
    )
  })

  it("humanizes unknown annotations and passes null through", () => {
    expect(formatShortsAnnotation("some_new_thing")).toBe("some new thing")
    expect(formatShortsAnnotation(null)).toBeNull()
  })
})

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "pb1",
    sourceMediaTitle: "The Source Film",
    languages: [],
    options: {
      shorts: {
        assetId: "mux-1-short-abcd1234",
        sourceMuxAssetId: "mux-1",
        sourcePlaybackId: "pb1",
        sourceCoreId: "core-1",
        sourceSlug: "the-source-film",
        sourceTitle: "The Source Film",
        clip: { startSec: 65, endSec: 95 },
        language: { bcp47: "en", whisper: "en" },
      },
    },
    status: "completed",
    retries: 0,
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    artifacts: {
      shorts: {
        kind: "metadata",
        data: {
          domain: "shorts",
          phase: "ready_for_review",
          annotation: null,
          hasAudio: true,
          clipDurationSec: 30,
          captionsCount: 42,
          draftVersion: 2,
          lastRenderedDraftVersion: 1,
          lastRenderedPropsHash: null,
          output: { muxAssetId: null, playbackId: null, ready: false },
          updatedAt: "2026-06-11T00:00:00.000Z",
        },
      },
    },
    steps: [],
    errors: [],
    ...overrides,
  }
}

describe("getShortsJobSummary", () => {
  it("returns null for non-shorts jobs", () => {
    expect(getShortsJobSummary(buildJob({ options: {} }))).toBeNull()
  })

  it("projects the summary from options + report", () => {
    const summary = getShortsJobSummary(buildJob())
    expect(summary).toMatchObject({
      assetId: "mux-1-short-abcd1234",
      sourceMuxAssetId: "mux-1",
      sourceCoreId: "core-1",
      sourceSlug: "the-source-film",
      sourceVideoTitle: "The Source Film",
      title: "The Source Film",
      languageBcp47: "en",
      languageLabel: "English (en)",
      languageShortLabel: "EN",
      languageFlagUrl: "https://hatscripts.github.io/circle-flags/flags/us.svg",
      clipRangeLabel: "1:05–1:35",
      phase: "ready_for_review",
      phaseLabel: "Ready for review",
      phaseTone: "pending",
      isStale: true,
    })
  })

  it("keeps the cropped source title separate from a custom short title", () => {
    const job = buildJob({ sourceMediaTitle: "Original Source Video" })
    if (job.options.shorts) {
      job.options.shorts.sourceTitle = "Custom Short Title"
    }

    const summary = getShortsJobSummary(job)
    expect(summary?.title).toBe("Custom Short Title")
    expect(summary?.sourceVideoTitle).toBe("Original Source Video")
  })

  it("projects a regional language into a compact flag chip", () => {
    const job = buildJob()
    if (job.options.shorts) {
      job.options.shorts.language = { bcp47: "pt-BR", whisper: "pt" }
    }

    const summary = getShortsJobSummary(job)
    expect(summary).toMatchObject({
      languageLabel: "Brazilian Portuguese (pt-BR)",
      languageShortLabel: "PT-BR",
      languageFlagUrl: "https://hatscripts.github.io/circle-flags/flags/br.svg",
    })
  })

  it("falls back to the short assetId as title and queued without a report", () => {
    const job = buildJob({ artifacts: {}, sourceMediaTitle: undefined })
    if (job.options.shorts) {
      delete job.options.shorts.sourceTitle
    }
    const summary = getShortsJobSummary(job)
    expect(summary?.title).toBe("mux-1-short-abcd1234")
    expect(summary?.phase).toBe("queued")
    expect(summary?.isStale).toBe(false)
  })

  it("presents queued + failed as launch failed (todo 010)", () => {
    const summary = getShortsJobSummary(
      buildJob({ artifacts: {}, status: "failed" }),
    )
    expect(summary).toMatchObject({
      phase: "queued",
      phaseLabel: "Launch failed",
      phaseTone: "failed",
      isLaunchFailed: true,
    })
  })

  it("keeps a genuinely queued job presented as queued", () => {
    const summary = getShortsJobSummary(
      buildJob({ artifacts: {}, status: "pending" }),
      { now: new Date("2026-06-11T00:01:00.000Z") },
    )
    expect(summary).toMatchObject({
      phase: "queued",
      phaseLabel: "Queued",
      phaseTone: "pending",
      isLaunchFailed: false,
    })
  })

  it("presents stale queued work as launch stalled", () => {
    const summary = getShortsJobSummary(
      buildJob({ artifacts: {}, status: "pending" }),
      { now: new Date("2026-06-11T00:10:00.000Z") },
    )
    expect(summary).toMatchObject({
      phase: "queued",
      phaseLabel: "Launch stalled",
      phaseTone: "failed",
      isLaunchFailed: false,
      activeStall: expect.objectContaining({ retryKind: "prepare" }),
    })
  })

  it("does not flag failed jobs in non-queued phases as launch failed", () => {
    // A failed render leaves phase "render_failed" — the phase mapping owns
    // that label; isLaunchFailed stays false.
    const summary = getShortsJobSummary(buildJob({ status: "failed" }))
    expect(summary).toMatchObject({
      phase: "ready_for_review",
      phaseLabel: "Ready for review",
      isLaunchFailed: false,
    })
  })
})

describe("output + clone helpers", () => {
  it("builds public Watch hrefs for source videos", () => {
    expect(
      buildSourceWatchHref(
        {
          sourceSlug: "the-source-film",
          languageBcp47: "en",
        },
        "https://www.jesusfilm.org/watch",
      ),
    ).toBe("https://www.jesusfilm.org/watch/the-source-film.html")
  })

  it("keeps collision-owned English source URLs explicit", () => {
    expect(
      buildSourceWatchHref(
        {
          sourceSlug: "russian",
          languageBcp47: "en",
        },
        "https://www.jesusfilm.org",
      ),
    ).toBe("https://www.jesusfilm.org/watch/russian.html/english.html")
  })

  it("maps regional source languages to public Watch language slugs", () => {
    expect(
      buildSourceWatchHref(
        {
          sourceSlug: "jesus-film",
          languageBcp47: "pt-BR",
        },
        "https://preview.example",
      ),
    ).toBe(
      "https://preview.example/watch/jesus-film.html/portuguese-brazil.html",
    )
  })

  it("returns null for source Watch hrefs when the slug is missing", () => {
    expect(
      buildSourceWatchHref({
        sourceSlug: null,
        languageBcp47: "en",
      }),
    ).toBeNull()
  })

  it("only offers downloads on completed", () => {
    expect(canDownloadShortsOutput({ phase: "completed" })).toBe(true)
    for (const phase of ALL_PHASES.filter((p) => p !== "completed")) {
      expect(canDownloadShortsOutput({ phase })).toBe(false)
    }
  })

  it("builds media hrefs with encoded job ids", () => {
    expect(buildShortsMediaHref("job 1", "clip")).toBe(
      "/api/shorts/jobs/job%201/media/clip",
    )
    expect(buildShortsMediaHref("job-1", "output")).toBe(
      "/api/shorts/jobs/job-1/media/output",
    )
  })

  it("builds the clone href from the source coreId + clip bounds", () => {
    expect(
      buildShortsCloneHref({
        sourceCoreId: "core-1",
        clip: { startSec: 65, endSec: 95.5 },
      }),
    ).toBe("/dashboard/shorts/new?coreId=core-1&start=65&end=95.5")
  })

  it("returns null without a source coreId", () => {
    expect(
      buildShortsCloneHref({
        sourceCoreId: undefined,
        clip: { startSec: 0, endSec: 30 },
      }),
    ).toBeNull()
  })
})
