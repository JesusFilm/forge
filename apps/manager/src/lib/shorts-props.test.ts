import { describe, expect, it } from "vitest"
import type { ShortDraft } from "@forge/shorts-compositions/schema"
import type { ShortsClipMeta } from "@/lib/shorts-artifacts"
import {
  buildShortsRenderPropsArtifact,
  canonicalJsonStringify,
  computePropsHash,
  parseShortsRenderPropsArtifact,
  resolveShortInputProps,
  ShortsPropsValidationError,
  type ShortRenderProps,
} from "@/lib/shorts-props"

const CLIP_IDENTITY = {
  assetId: "mux-1-short-abc12345",
  artifactType: "shorts-clip-v1" as const,
}

function buildDraft(overrides: Partial<ShortDraft> = {}): ShortDraft {
  return {
    templateId: "focus",
    accentColor: "#facc15",
    captionPosition: "lower",
    captionFont: "montserrat",
    waveformStyle: "bars",
    showCaptions: true,
    captionPages: [
      {
        text: "Hello world",
        startMs: 0,
        durationMs: 1000,
        tokens: [
          { text: "Hello", fromMs: 0, toMs: 400 },
          { text: " world", fromMs: 400, toMs: 1000 },
        ],
      },
    ],
    ...overrides,
  }
}

function buildClipMeta(
  overrides: Partial<ShortsClipMeta> = {},
): ShortsClipMeta {
  return {
    sourceHost: "stream.mux.com",
    clip: { startSec: 10, endSec: 40 },
    durationSec: 30,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
    generatedAt: "2026-06-11T10:00:00.000Z",
    ...overrides,
  }
}

describe("resolveShortInputProps", () => {
  it("composes draft knobs with clip-meta server fields", () => {
    const props = resolveShortInputProps({
      draft: buildDraft({ title: "My Short" }),
      clipMeta: buildClipMeta(),
    })

    expect(props).toMatchObject({
      templateId: "focus",
      accentColor: "#facc15",
      captionPosition: "lower",
      captionFont: "montserrat",
      waveformStyle: "bars",
      title: "My Short",
      showCaptions: true,
      fps: 30,
      clipDurationSec: 30,
      hasAudio: true,
    })
    expect("clipUrl" in props).toBe(false)
  })

  it("omits title when the draft has none", () => {
    const props = resolveShortInputProps({
      draft: buildDraft(),
      clipMeta: buildClipMeta(),
    })
    expect("title" in props).toBe(false)
  })

  it("rounds a near-integer probed fps to satisfy the int schema", () => {
    const props = resolveShortInputProps({
      draft: buildDraft(),
      clipMeta: buildClipMeta({ fps: 29.999999 }),
    })
    expect(props.fps).toBe(30)
  })

  it("throws the typed error on schema violations", () => {
    expect(() =>
      resolveShortInputProps({
        draft: buildDraft(),
        clipMeta: buildClipMeta({ durationSec: -1 }),
      }),
    ).toThrow(ShortsPropsValidationError)
  })
})

describe("canonicalJsonStringify", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    )
  })

  it("keeps array order", () => {
    expect(canonicalJsonStringify([2, 1, { b: 1, a: 2 }])).toBe(
      '[2,1,{"a":2,"b":1}]',
    )
  })

  it("drops undefined object values like JSON.stringify", () => {
    expect(canonicalJsonStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })
})

describe("computePropsHash", () => {
  const props = (): ShortRenderProps =>
    resolveShortInputProps({ draft: buildDraft(), clipMeta: buildClipMeta() })

  it("returns 64 lowercase hex chars", () => {
    expect(computePropsHash(props(), CLIP_IDENTITY)).toMatch(/^[a-f0-9]{64}$/)
  })

  it("is independent of object key insertion order", () => {
    const base = props()
    // Same fields, different literal insertion order.
    const reordered = Object.fromEntries(
      Object.entries(base).reverse(),
    ) as ShortRenderProps

    expect(computePropsHash(reordered, CLIP_IDENTITY)).toBe(
      computePropsHash(base, CLIP_IDENTITY),
    )
  })

  it("changes when array order changes", () => {
    const twoPages = resolveShortInputProps({
      draft: buildDraft({
        captionPages: [
          {
            text: "One",
            startMs: 0,
            durationMs: 500,
            tokens: [{ text: "One", fromMs: 0, toMs: 500 }],
          },
          {
            text: "Two",
            startMs: 500,
            durationMs: 500,
            tokens: [{ text: "Two", fromMs: 500, toMs: 1000 }],
          },
        ],
      }),
      clipMeta: buildClipMeta(),
    })
    const swapped: ShortRenderProps = {
      ...twoPages,
      captionPages: [...twoPages.captionPages].reverse(),
    }

    expect(computePropsHash(swapped, CLIP_IDENTITY)).not.toBe(
      computePropsHash(twoPages, CLIP_IDENTITY),
    )
  })

  it("changes when the clip identity changes", () => {
    const base = props()
    expect(
      computePropsHash(base, {
        ...CLIP_IDENTITY,
        assetId: "mux-1-short-zzz99999",
      }),
    ).not.toBe(computePropsHash(base, CLIP_IDENTITY))
  })

  it("changes when a knob changes", () => {
    const base = props()
    expect(
      computePropsHash({ ...base, accentColor: "#ff0000" }, CLIP_IDENTITY),
    ).not.toBe(computePropsHash(base, CLIP_IDENTITY))
  })
})

describe("render-props audit artifact", () => {
  it("round-trips through build + parse", () => {
    const renderProps = resolveShortInputProps({
      draft: buildDraft(),
      clipMeta: buildClipMeta(),
    })
    const artifact = buildShortsRenderPropsArtifact({
      propsHash: computePropsHash(renderProps, CLIP_IDENTITY),
      draftVersion: 2,
      props: renderProps,
      generatedAt: "2026-06-11T12:00:00.000Z",
    })

    expect(parseShortsRenderPropsArtifact(artifact)).toEqual(artifact)
  })

  it("rejects malformed audit payloads", () => {
    expect(parseShortsRenderPropsArtifact(null)).toBeNull()
    expect(
      parseShortsRenderPropsArtifact({ propsHash: "nope", draftVersion: 1 }),
    ).toBeNull()
  })
})
