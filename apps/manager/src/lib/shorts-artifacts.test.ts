import { describe, expect, it } from "vitest"
import {
  buildShortsMuxOutputRecord,
  parseShortsCaptionsArtifact,
  parseShortsClipMeta,
  parseShortsMuxOutputRecord,
  parseShortsRenderMeta,
  shouldSkipPrepareWorker,
} from "@/lib/shorts-artifacts"

// Fixtures use the PRODUCER's actual shapes (apps/shorts-worker src/types.ts
// ClipMetaArtifact + CaptionsArtifact) — producer-consumer report-file
// contract discipline.
const CLIP_META = {
  sourceHost: "stream.mux.com",
  clip: { startSec: 12, endSec: 42 },
  durationSec: 30,
  fps: 30,
  width: 1920,
  height: 1080,
  hasAudio: true,
  generatedAt: "2026-06-11T10:00:00.000Z",
}

const CAPTIONS = {
  captions: [
    {
      text: "Hello",
      startMs: 0,
      endMs: 500,
      timestampMs: 250,
      confidence: 0.98,
    },
  ],
  language: "en",
  model: "large-v3-turbo",
  annotation: null,
  generatedAt: "2026-06-11T10:00:01.000Z",
}

describe("parseShortsClipMeta", () => {
  it("parses the worker's clip meta artifact", () => {
    expect(parseShortsClipMeta(CLIP_META)).toMatchObject({
      durationSec: 30,
      fps: 30,
      hasAudio: true,
    })
  })

  it("returns null on malformed payloads", () => {
    expect(parseShortsClipMeta(null)).toBeNull()
    expect(parseShortsClipMeta({ ...CLIP_META, durationSec: "30" })).toBeNull()
    expect(
      parseShortsClipMeta({ ...CLIP_META, hasAudio: undefined }),
    ).toBeNull()
  })
})

describe("parseShortsCaptionsArtifact", () => {
  it("parses the worker's captions artifact", () => {
    expect(parseShortsCaptionsArtifact(CAPTIONS)).toMatchObject({
      language: "en",
      annotation: null,
    })
    expect(parseShortsCaptionsArtifact(CAPTIONS)?.captions).toHaveLength(1)
  })

  it("accepts the no-audio degradation shape", () => {
    expect(
      parseShortsCaptionsArtifact({
        captions: [],
        language: null,
        model: null,
        annotation: "transcription_skipped_no_audio",
        generatedAt: "2026-06-11T10:00:01.000Z",
      }),
    ).toMatchObject({ annotation: "transcription_skipped_no_audio" })
  })

  it("returns null on malformed payloads", () => {
    expect(parseShortsCaptionsArtifact(null)).toBeNull()
    expect(
      parseShortsCaptionsArtifact({ ...CAPTIONS, captions: "none" }),
    ).toBeNull()
  })
})

describe("shouldSkipPrepareWorker (reuse-not-rerun provenance path)", () => {
  const clipMeta = parseShortsClipMeta(CLIP_META)
  const captions = parseShortsCaptionsArtifact(CAPTIONS)

  it("skips the worker only when the clip exists, both JSON artifacts parsed, and no force", () => {
    expect(
      shouldSkipPrepareWorker({
        force: false,
        clipExists: true,
        clipMeta,
        captions,
      }),
    ).toBe(true)
  })

  it("never skips under force", () => {
    expect(
      shouldSkipPrepareWorker({
        force: true,
        clipExists: true,
        clipMeta,
        captions,
      }),
    ).toBe(false)
  })

  it("does not skip when the clip MP4 is missing", () => {
    expect(
      shouldSkipPrepareWorker({
        force: false,
        clipExists: false,
        clipMeta,
        captions,
      }),
    ).toBe(false)
  })

  it("does not skip when either JSON artifact is missing or malformed", () => {
    expect(
      shouldSkipPrepareWorker({
        force: false,
        clipExists: true,
        clipMeta: null,
        captions,
      }),
    ).toBe(false)
    expect(
      shouldSkipPrepareWorker({
        force: false,
        clipExists: true,
        clipMeta,
        captions: null,
      }),
    ).toBe(false)
  })
})

describe("parseShortsRenderMeta", () => {
  it("parses the worker's render meta artifact", () => {
    const meta = {
      propsHash: "b".repeat(64),
      renderedDraftVersion: 2,
      compositionsVersion: "2026-06-11.1",
      generatedAt: "2026-06-11T12:00:00.000Z",
    }
    expect(parseShortsRenderMeta(meta)).toEqual(meta)
  })

  it("returns null on malformed payloads", () => {
    expect(parseShortsRenderMeta(null)).toBeNull()
    expect(parseShortsRenderMeta({ propsHash: 5 })).toBeNull()
  })
})

describe("shorts Mux output record", () => {
  const PROPS_HASH = "a".repeat(64)

  it("round-trips through build + parse (propsHash carried)", () => {
    const record = buildShortsMuxOutputRecord({
      jobId: "job-1",
      muxAssetId: "mux-out-1",
      propsHash: PROPS_HASH,
      ready: false,
      createdAt: "2026-06-11T12:00:00.000Z",
    })
    expect(record.propsHash).toBe(PROPS_HASH)
    expect(parseShortsMuxOutputRecord(record)).toEqual(record)
  })

  it("records playbackId only when present", () => {
    const ready = buildShortsMuxOutputRecord({
      jobId: "job-1",
      muxAssetId: "mux-out-1",
      propsHash: PROPS_HASH,
      ready: true,
      playbackId: "pb-1",
    })
    expect(ready.playbackId).toBe("pb-1")
    expect(parseShortsMuxOutputRecord(ready)?.playbackId).toBe("pb-1")
  })

  it("parses a legacy record without propsHash as propsHash undefined", () => {
    // Pre-propsHash records must still parse — and the undefined hash never
    // matches a real one, so the Mux output step treats them as stale.
    const parsed = parseShortsMuxOutputRecord({
      version: 1,
      kind: "shorts-mux-output",
      jobId: "job-1",
      muxAssetId: "mux-out-legacy",
      ready: true,
      createdAt: "2026-06-11T12:00:00.000Z",
    })
    expect(parsed).toMatchObject({ muxAssetId: "mux-out-legacy", ready: true })
    expect(parsed?.propsHash).toBeUndefined()
  })

  it("rejects foreign record kinds", () => {
    expect(
      parseShortsMuxOutputRecord({
        kind: "smart-crop-mux-output",
        jobId: "job-1",
        muxAssetId: "mux-out-1",
        ready: true,
      }),
    ).toBeNull()
  })
})
