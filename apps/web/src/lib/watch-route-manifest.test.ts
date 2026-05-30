import { describe, expect, it } from "vitest"

import {
  isWatchRouteAdmittedByManifest,
  parseWatchRouteManifest,
  type WatchRouteManifest,
} from "./watch-route-manifest"

const manifest: WatchRouteManifest = {
  version: "version-1",
  generatedAt: "2026-05-29T12:00:00.000Z",
  contentSlugs: ["easter", "jesus"],
  oneSegmentSlugs: ["easter"],
  episodePairsByParent: {
    jesus: ["the-beginning", "missing-language"],
  },
  audioLanguageSlugs: ["english", "spanish-latin-american"],
  audioLanguageIndexesByContent: {
    jesus: [0],
  },
  audioLanguageIndexesByEpisode: {
    jesus: {
      "the-beginning": [1],
      "missing-language": [0],
    },
  },
}

describe("parseWatchRouteManifest", () => {
  it("accepts the admin manifest contract", () => {
    expect(parseWatchRouteManifest(manifest)).toEqual(manifest)
  })

  it("rejects payloads that do not carry bounded admission sets", () => {
    expect(
      parseWatchRouteManifest({
        ...manifest,
        episodePairsByParent: { jesus: "the-beginning" },
      }),
    ).toBeNull()
    expect(
      parseWatchRouteManifest({
        ...manifest,
        audioLanguageSlugs: [null],
      }),
    ).toBeNull()
    expect(
      parseWatchRouteManifest({
        ...manifest,
        audioLanguageIndexesByContent: { jesus: [null] },
      }),
    ).toBeNull()
    expect(
      parseWatchRouteManifest({
        ...manifest,
        audioLanguageIndexesByEpisode: { jesus: { "the-beginning": [null] } },
      }),
    ).toBeNull()
  })
})

describe("isWatchRouteAdmittedByManifest", () => {
  it("admits valid one-segment, video, and episode shapes", () => {
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "one-segment",
        slug: "easter",
      }),
    ).toBe(true)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "video",
        contentSlug: "jesus",
        audioLanguageSlug: "english",
      }),
    ).toBe(true)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "episode",
        parentSlug: "jesus",
        childSlug: "the-beginning",
        audioLanguageSlug: "spanish-latin-american",
      }),
    ).toBe(true)
  })

  it("rejects unknown slugs and content/audio combinations outside the exact route-audio index", () => {
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "video",
        contentSlug: "anything",
        audioLanguageSlug: "english",
      }),
    ).toBe(false)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "episode",
        parentSlug: "jesus",
        childSlug: "anything",
        audioLanguageSlug: "english",
      }),
    ).toBe(false)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "video",
        contentSlug: "jesus",
        audioLanguageSlug: "en",
      }),
    ).toBe(false)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "video",
        contentSlug: "jesus",
        audioLanguageSlug: "spanish-latin-american",
      }),
    ).toBe(false)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "episode",
        parentSlug: "jesus",
        childSlug: "the-beginning",
        audioLanguageSlug: "english",
      }),
    ).toBe(false)
  })
})
