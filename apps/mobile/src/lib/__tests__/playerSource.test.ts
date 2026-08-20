import { resolvePlayerSource } from "../playerSource"

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
