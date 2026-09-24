import {
  isDubSwap,
  isOfflineContainerSwap,
  offlineSwapClaim,
  resolvePlayerSource,
} from "../playerSource"

const SEED = "https://stream.mux.com/seedAsset.m3u8"
const RECORD = "https://stream.mux.com/firstPlayable.m3u8"
const VARIANT = "https://stream.mux.com/settledDub.m3u8"
const OFFLINE = "file:///offline/slug/video.mp4"
// Shared by the two swap predicates below, which are deliberately paired on
// the same inputs.
const MUX = "https://stream.mux.com/abc123.m3u8"
const MUX_OTHER = "https://stream.mux.com/zzz999.m3u8"
const LOCAL = "file:///docs/offline-downloads/the-birth-of-jesus/a.mp4"
const isLocal = (url: string) => url.startsWith("file:")

describe("resolvePlayerSource (the watch screen's source precedence)", () => {
  it("keeps the seed until the dub selection settles — never the record fallback", () => {
    // The record fallback is `firstPlayable` (`dubs[0]`), which for a multi-dub
    // video is the WRONG language before resolution. Publishing it flashes that
    // dub's stream on a fresh visit, and on an expand it reads as a dub switch,
    // defeats R4's adoption, and restarts playback.
    expect(
      resolvePlayerSource({
        offlineSource: null,
        offlineDubDocumentId: null,
        activeVariantDocumentId: null,
        activeVariantHls: null,
        variantSettled: false,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: SEED,
      }),
    ).toBe(SEED)
  })

  it("resolves nothing before settle when there is no seed", () => {
    expect(
      resolvePlayerSource({
        offlineSource: null,
        offlineDubDocumentId: null,
        activeVariantDocumentId: null,
        activeVariantHls: null,
        variantSettled: false,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: null,
      }),
    ).toBeNull()
  })

  it("prefers the settled dub over every remote fallback", () => {
    expect(
      resolvePlayerSource({
        offlineSource: null,
        offlineDubDocumentId: null,
        activeVariantDocumentId: null,
        activeVariantHls: VARIANT,
        variantSettled: true,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: SEED,
      }),
    ).toBe(VARIANT)
  })

  it("falls back to the record stream only once settled", () => {
    expect(
      resolvePlayerSource({
        offlineSource: null,
        offlineDubDocumentId: null,
        activeVariantDocumentId: null,
        activeVariantHls: null,
        variantSettled: true,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: SEED,
      }),
    ).toBe(RECORD)
  })

  it("falls back to the seed when a settled video has no stream at all", () => {
    expect(
      resolvePlayerSource({
        offlineSource: null,
        offlineDubDocumentId: null,
        activeVariantDocumentId: null,
        activeVariantHls: null,
        variantSettled: true,
        recordStreamingUrl: null,
        seedStreamingUrl: SEED,
      }),
    ).toBe(SEED)
  })

  it("plays the completed download when the dub on disk is unknown", () => {
    expect(
      resolvePlayerSource({
        offlineSource: OFFLINE,
        offlineDubDocumentId: null,
        activeVariantDocumentId: null,
        activeVariantHls: VARIANT,
        variantSettled: true,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: SEED,
      }),
    ).toBe(OFFLINE)
  })

  // The download is ONE dub. A viewer who picks another language on a
  // downloaded video must hear that language, so the pick streams unless it
  // is the dub on disk.
  it("streams the settled dub when it is not the downloaded dub", () => {
    expect(
      resolvePlayerSource({
        offlineSource: OFFLINE,
        offlineDubDocumentId: "dub-english",
        activeVariantHls: VARIANT,
        activeVariantDocumentId: "dub-french",
        variantSettled: true,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: SEED,
      }),
    ).toBe(VARIANT)
  })

  it("keeps the download when the settled dub is the downloaded one", () => {
    expect(
      resolvePlayerSource({
        offlineSource: OFFLINE,
        offlineDubDocumentId: "dub-english",
        activeVariantHls: VARIANT,
        activeVariantDocumentId: "dub-english",
        variantSettled: true,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: SEED,
      }),
    ).toBe(OFFLINE)
  })

  it("keeps the download when the picked dub has no stream to play", () => {
    expect(
      resolvePlayerSource({
        offlineSource: OFFLINE,
        offlineDubDocumentId: "dub-english",
        activeVariantHls: null,
        activeVariantDocumentId: "dub-french",
        variantSettled: true,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: SEED,
      }),
    ).toBe(OFFLINE)
  })

  it("keeps the download before the dub selection settles", () => {
    expect(
      resolvePlayerSource({
        offlineSource: OFFLINE,
        offlineDubDocumentId: "dub-english",
        activeVariantHls: null,
        activeVariantDocumentId: null,
        variantSettled: false,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: SEED,
      }),
    ).toBe(OFFLINE)
  })

  // One fixture per guard of `offlinePlays`, each holding every OTHER axis at
  // the value that would STREAM, so only the guard under test can keep the
  // file. Deleting that guard turns exactly its case red.
  describe("each guard that keeps the download has its own fixture", () => {
    const streaming = {
      offlineSource: OFFLINE,
      offlineDubDocumentId: "dub-english",
      activeVariantHls: VARIANT,
      activeVariantDocumentId: "dub-french",
      variantSettled: true,
      recordStreamingUrl: RECORD,
      seedStreamingUrl: SEED,
    }

    it("control: every axis permissive streams the picked dub", () => {
      expect(resolvePlayerSource(streaming)).toBe(VARIANT)
    })

    it("guard 1: an unsettled dub keeps the file even when the ids differ", () => {
      expect(resolvePlayerSource({ ...streaming, variantSettled: false })).toBe(
        OFFLINE,
      )
    })

    it("guard 2: an unknown dub on disk keeps the file against a settled pick", () => {
      expect(
        resolvePlayerSource({ ...streaming, offlineDubDocumentId: null }),
      ).toBe(OFFLINE)
    })

    // SYNTHETIC: the one call site derives `activeVariantDocumentId:
    // activeVariant?.documentId ?? null` beside `variantSettled: activeVariant
    // != null` (app/watch/[slug].tsx), so a settled dub with no id is not
    // producible today. The fixture pins the guard, not a reachable state.
    it("guard 3: a settled dub with no identity keeps the file", () => {
      expect(
        resolvePlayerSource({ ...streaming, activeVariantDocumentId: null }),
      ).toBe(OFFLINE)
    })
  })
})

/**
 * What an offline container swap tells the adapter: the QoE session re-keys
 * only when both sides name a language and they differ. Its host caller is
 * pinned through useManagedVideoPlayer.test.tsx; the table here owns the null
 * guards, which no host case reaches.
 */
describe("offlineSwapClaim", () => {
  it.each([
    [null, null, "same-content"],
    [null, "english", "same-content"],
    ["english", null, "same-content"],
    ["english", "english", "same-content"],
    ["english", "french", "new-content"],
  ])("previous %p, next %p -> %p", (previous, next, claim) => {
    expect(
      offlineSwapClaim({
        previousLanguageSlug: previous,
        nextLanguageSlug: next,
      }),
    ).toBe(claim)
  })
})

/**
 * The predicate that separates "the same video moved between the network and a
 * completed download" from "a different video". A dub change keeps the slug
 * and also fails isSameMuxAsset, so the local-ness half is what tells them
 * apart — a dub change is `isDubSwap`'s claim, below, never this one's.
 */
describe("isOfflineContainerSwap", () => {
  const LOCAL_OTHER = "file:///docs/offline-downloads/the-birth-of-jesus/b.mp4"

  const swap = (
    previousUrl: string | null,
    nextUrl: string | null,
    sameVideo = true,
  ) => isOfflineContainerSwap({ previousUrl, nextUrl, sameVideo, isLocal })

  it("is true when a completed download replaces the stream", () => {
    expect(swap(MUX, LOCAL)).toBe(true)
  })

  it("is true in reverse, when the download is deleted mid-play", () => {
    expect(swap(LOCAL, MUX)).toBe(true)
  })

  it("is FALSE for a dub change — same video, still remote", () => {
    // The discriminating case. Both URLs fail isSameMuxAsset and both belong to
    // one slug, so only local-ness separates a dub change from an offline swap.
    expect(swap(MUX, MUX_OTHER)).toBe(false)
  })

  it("is false for a different video, in either direction", () => {
    expect(swap(MUX, LOCAL, false)).toBe(false)
    expect(swap(LOCAL, MUX, false)).toBe(false)
  })

  it("is false when both sides are local — that is not a container change", () => {
    expect(swap(LOCAL, LOCAL_OTHER)).toBe(false)
  })

  it("is false without both sources, and false for an unchanged url", () => {
    expect(swap(null, LOCAL)).toBe(false)
    expect(swap(MUX, null)).toBe(false)
    expect(swap(LOCAL, LOCAL)).toBe(false)
  })

  it("asks the injected validator, so a stray file: URI is not our download", () => {
    // The host injects validateLocalMediaUrl bound to OFFLINE_ROOT; a file
    // outside it must not read as a completed download.
    const onlyOurRoot = (url: string) =>
      url.startsWith("file:///docs/offline-downloads/")
    expect(
      isOfflineContainerSwap({
        previousUrl: MUX,
        nextUrl: "file:///tmp/elsewhere/a.mp4",
        sameVideo: true,
        isLocal: onlyOurRoot,
      }),
    ).toBe(false)
  })
})

/**
 * The predicate that names a dub change: one video, two remote Mux assets. It
 * keeps the viewer's place like an offline swap does, but it is NEW content
 * for quality attribution, so the host reports it separately.
 */
describe("isDubSwap", () => {
  const swap = (
    previousUrl: string | null,
    nextUrl: string | null,
    sameVideo = true,
  ) => isDubSwap({ previousUrl, nextUrl, sameVideo, sameAsset: false, isLocal })

  it("is true for the same video on a different remote asset", () => {
    expect(swap(MUX, MUX_OTHER)).toBe(true)
  })

  it("is false for the same asset — that is a constraint swap or a no-op", () => {
    expect(
      isDubSwap({
        previousUrl: MUX,
        nextUrl: MUX_OTHER,
        sameVideo: true,
        sameAsset: true,
        isLocal,
      }),
    ).toBe(false)
  })

  it("is false for an unchanged url — a non-Mux url has no asset id to compare", () => {
    expect(swap(MUX, MUX)).toBe(false)
  })

  it("is false for a different video", () => {
    expect(swap(MUX, MUX_OTHER, false)).toBe(false)
  })

  it("is false when either side is local — that is the offline swap's claim", () => {
    expect(swap(MUX, LOCAL)).toBe(false)
    expect(swap(LOCAL, MUX)).toBe(false)
  })

  it("is false without both sources", () => {
    expect(swap(null, MUX_OTHER)).toBe(false)
    expect(swap(MUX, null)).toBe(false)
  })
})
