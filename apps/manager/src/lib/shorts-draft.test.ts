import { describe, expect, it } from "vitest"
import type { ShortsCaption } from "@/lib/shorts-artifacts"
import {
  buildInitialDraft,
  INITIAL_DRAFT_UPDATED_BY,
  parseShortsDraftArtifact,
  shouldResetDraft,
} from "@/lib/shorts-draft"

const NOW = () => new Date("2026-06-11T12:00:00.000Z")
const CAPTIONS_AT = "2026-06-11T10:00:00.000Z"

// Whisper-word fixture in the worker's shorts-captions-v1 caption shape
// (matches @remotion/captions' Caption type).
const CAPTIONS: ShortsCaption[] = [
  { text: "Jesus", startMs: 0, endMs: 420, timestampMs: 200, confidence: 0.98 },
  {
    text: " said",
    startMs: 420,
    endMs: 800,
    timestampMs: 600,
    confidence: 0.97,
  },
  {
    text: " follow",
    startMs: 800,
    endMs: 1300,
    timestampMs: 1000,
    confidence: 0.95,
  },
  {
    text: " me",
    startMs: 1300,
    endMs: 1600,
    timestampMs: 1450,
    confidence: 0.99,
  },
  // A second utterance far enough away to land on a new page.
  {
    text: "Come",
    startMs: 4000,
    endMs: 4400,
    timestampMs: 4200,
    confidence: 0.96,
  },
  {
    text: " and",
    startMs: 4400,
    endMs: 4700,
    timestampMs: 4550,
    confidence: 0.92,
  },
  {
    text: " see",
    startMs: 4700,
    endMs: 5100,
    timestampMs: 4900,
    confidence: 0.97,
  },
]

describe("buildInitialDraft", () => {
  it("builds the default knobs with caption pages from whisper words", () => {
    const artifact = buildInitialDraft(CAPTIONS, CAPTIONS_AT, NOW)

    expect(artifact.draftVersion).toBe(1)
    expect(artifact.captionsGeneratedAt).toBe(CAPTIONS_AT)
    expect(artifact.updatedBy).toBe(INITIAL_DRAFT_UPDATED_BY)
    expect(artifact.updatedAt).toBe("2026-06-11T12:00:00.000Z")
    expect(artifact.draft).toMatchObject({
      templateId: "focus",
      accentColor: "#facc15",
      captionPosition: "lower",
      captionFont: "montserrat",
      waveformStyle: "bars",
      showCaptions: true,
    })

    // Pages come from createTikTokStyleCaptions: tokens preserved with
    // timings, the 1.2s combine window splits the two utterances.
    expect(artifact.draft.captionPages.length).toBeGreaterThanOrEqual(2)
    const allTokens = artifact.draft.captionPages.flatMap((page) => page.tokens)
    expect(allTokens.map((token) => token.text.trim())).toEqual([
      "Jesus",
      "said",
      "follow",
      "me",
      "Come",
      "and",
      "see",
    ])
    expect(allTokens[0]).toMatchObject({ fromMs: 0, toMs: 420 })
  })

  it("validates against the draft artifact schema", () => {
    const artifact = buildInitialDraft(CAPTIONS, CAPTIONS_AT, NOW)
    expect(parseShortsDraftArtifact(artifact)).toEqual(artifact)
  })

  it("turns captions off for an empty caption set (no-audio path)", () => {
    const artifact = buildInitialDraft([], CAPTIONS_AT, NOW)
    expect(artifact.draft.showCaptions).toBe(false)
    expect(artifact.draft.captionPages).toEqual([])
  })
})

describe("parseShortsDraftArtifact", () => {
  it("rejects drafts smuggling server-injected fields into the draft", () => {
    const artifact = buildInitialDraft(CAPTIONS, CAPTIONS_AT, NOW)
    const smuggled = {
      ...artifact,
      draft: { ...artifact.draft, clipUrl: "https://evil.example/clip.mp4" },
    }
    // draftSchema is strict — unknown keys (clipUrl/fps/...) are rejected.
    expect(parseShortsDraftArtifact(smuggled)).toBeNull()
  })

  it("rejects malformed payloads", () => {
    expect(parseShortsDraftArtifact(null)).toBeNull()
    expect(parseShortsDraftArtifact({ draftVersion: 0 })).toBeNull()
  })
})

describe("shouldResetDraft", () => {
  const artifact = buildInitialDraft(CAPTIONS, CAPTIONS_AT, NOW)

  it("resets when there is no existing draft", () => {
    expect(shouldResetDraft(null, CAPTIONS_AT)).toBe(true)
  })

  it("keeps a draft whose captions provenance matches", () => {
    expect(shouldResetDraft(artifact, CAPTIONS_AT)).toBe(false)
  })

  it("resets when captions were regenerated (force-prepare discard)", () => {
    expect(shouldResetDraft(artifact, "2026-06-11T11:59:00.000Z")).toBe(true)
  })
})
