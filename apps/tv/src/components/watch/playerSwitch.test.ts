import { inPlayerMenuVisible, shouldReplaceSource } from "./playerSwitch"

const MUX_A = "https://stream.mux.com/aaaAAA111.m3u8"
// Same asset (same playback id) but a different URL string shape — e.g. the
// seed URL rebuilt from a playbackId vs the resolved variant's stored `hls`.
const MUX_A_ALT = "https://stream.mux.com/aaaAAA111.m3u8?token=x"
const MUX_B = "https://stream.mux.com/bbbBBB222.m3u8"
const NON_MUX = "https://example.com/video.m3u8"

// A minimal session-video shape: inPlayerMenuVisible only reads `variants.length`.
function sessionVideo(variantCount: number): { variants: readonly unknown[] } {
  return { variants: Array.from({ length: variantCount }, (_, i) => i) }
}

// ── shouldReplaceSource ──────────────────────────────────────────────────────

describe("shouldReplaceSource", () => {
  it("returns noop for the same Mux asset (same playback id)", () => {
    expect(shouldReplaceSource(MUX_A, MUX_A)).toBe("noop")
  })

  it("returns noop when only the URL string shape differs but the id matches", () => {
    // Same asset, different string → must NOT reload (avoids rebuffer flash).
    expect(shouldReplaceSource(MUX_A, MUX_A_ALT)).toBe("noop")
  })

  it("returns replace for a different Mux asset (different playback id)", () => {
    expect(shouldReplaceSource(MUX_A, MUX_B)).toBe("replace")
  })

  it("returns replace when the current url has no extractable id (first load)", () => {
    expect(shouldReplaceSource(null, MUX_A)).toBe("replace")
    expect(shouldReplaceSource(undefined, MUX_A)).toBe("replace")
    expect(shouldReplaceSource("", MUX_A)).toBe("replace")
  })

  it("returns noop when the next url is non-Mux (fails validateStreamingUrl)", () => {
    expect(shouldReplaceSource(MUX_A, NON_MUX)).toBe("noop")
  })

  it("returns noop when the next url is null / undefined / empty", () => {
    expect(shouldReplaceSource(MUX_A, null)).toBe("noop")
    expect(shouldReplaceSource(MUX_A, undefined)).toBe("noop")
    expect(shouldReplaceSource(MUX_A, "")).toBe("noop")
  })

  it("returns noop for a malformed next url string", () => {
    expect(shouldReplaceSource(MUX_A, "not a url")).toBe("noop")
  })
})

// ── inPlayerMenuVisible — the stale-session-safe gate ────────────────────────

describe("inPlayerMenuVisible", () => {
  // CHARACTERIZATION — no-session contract: playVideo(url) with no session must
  // never attach the in-player menu. Returning true here breaks the non-negotiable
  // invariant that experience-card playback stays UNCHANGED.
  it("returns false with NO session (experience-card playback unchanged)", () => {
    expect(
      inPlayerMenuVisible({
        sessionVideo: null,
        activeVariantHls: null,
        currentUrl: MUX_A,
      }),
    ).toBe(false)
    expect(
      inPlayerMenuVisible({
        sessionVideo: undefined,
        activeVariantHls: MUX_A,
        currentUrl: MUX_A,
      }),
    ).toBe(false)
  })

  it("returns true only when the playing URL matches the session's active dub", () => {
    expect(
      inPlayerMenuVisible({
        sessionVideo: sessionVideo(3),
        activeVariantHls: MUX_A,
        currentUrl: MUX_A,
      }),
    ).toBe(true)
  })

  it("matches by playback id, tolerating a URL-shape difference for the same asset", () => {
    expect(
      inPlayerMenuVisible({
        sessionVideo: sessionVideo(2),
        activeVariantHls: MUX_A,
        currentUrl: MUX_A_ALT,
      }),
    ).toBe(true)
  })

  it("returns false for a STALE session (playing URL is a different asset)", () => {
    // A leftover session from a prior details visit must not attach a menu to
    // an experience-card play of an unrelated URL.
    expect(
      inPlayerMenuVisible({
        sessionVideo: sessionVideo(3),
        activeVariantHls: MUX_A,
        currentUrl: MUX_B,
      }),
    ).toBe(false)
  })

  it("returns false when the session video has no variants", () => {
    expect(
      inPlayerMenuVisible({
        sessionVideo: sessionVideo(0),
        activeVariantHls: MUX_A,
        currentUrl: MUX_A,
      }),
    ).toBe(false)
  })

  it("returns false when there is no active dub HLS", () => {
    expect(
      inPlayerMenuVisible({
        sessionVideo: sessionVideo(3),
        activeVariantHls: null,
        currentUrl: MUX_A,
      }),
    ).toBe(false)
  })

  it("returns false when nothing is playing (no currentUrl)", () => {
    expect(
      inPlayerMenuVisible({
        sessionVideo: sessionVideo(3),
        activeVariantHls: MUX_A,
        currentUrl: null,
      }),
    ).toBe(false)
  })

  it("returns false when the active dub HLS is non-Mux (no id)", () => {
    expect(
      inPlayerMenuVisible({
        sessionVideo: sessionVideo(3),
        activeVariantHls: NON_MUX,
        currentUrl: MUX_A,
      }),
    ).toBe(false)
  })
})
