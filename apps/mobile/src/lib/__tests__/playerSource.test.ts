import { isOfflineContainerSwap, resolvePlayerSource } from "../playerSource"

const SEED = "https://stream.mux.com/seedAsset.m3u8"
const RECORD = "https://stream.mux.com/firstPlayable.m3u8"
const VARIANT = "https://stream.mux.com/settledDub.m3u8"
const OFFLINE = "file:///offline/slug/video.mp4"

describe("resolvePlayerSource (the watch screen's source precedence)", () => {
  it("keeps the seed until the dub selection settles — never the record fallback", () => {
    // The record fallback is `firstPlayable` (`dubs[0]`), which for a multi-dub
    // video is the WRONG language before resolution. Publishing it flashes that
    // dub's stream on a fresh visit, and on an expand it reads as a dub switch,
    // defeats R4's adoption, and restarts playback.
    expect(
      resolvePlayerSource({
        offlineSource: null,
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
        activeVariantHls: null,
        variantSettled: true,
        recordStreamingUrl: null,
        seedStreamingUrl: SEED,
      }),
    ).toBe(SEED)
  })

  it("plays the completed download above everything", () => {
    expect(
      resolvePlayerSource({
        offlineSource: OFFLINE,
        activeVariantHls: VARIANT,
        variantSettled: true,
        recordStreamingUrl: RECORD,
        seedStreamingUrl: SEED,
      }),
    ).toBe(OFFLINE)
  })
})

/**
 * The predicate that separates "the same video moved between the network and a
 * completed download" from "a different video". A dub change keeps the slug
 * and also fails isSameMuxAsset, so the local-ness half is what tells them
 * apart — and a dub change must still restart.
 */
describe("isOfflineContainerSwap", () => {
  const MUX = "https://stream.mux.com/abc123.m3u8"
  const MUX_OTHER = "https://stream.mux.com/zzz999.m3u8"
  const LOCAL = "file:///docs/offline-downloads/the-birth-of-jesus/a.mp4"
  const LOCAL_OTHER = "file:///docs/offline-downloads/the-birth-of-jesus/b.mp4"
  const isLocal = (url: string) => url.startsWith("file:")

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
