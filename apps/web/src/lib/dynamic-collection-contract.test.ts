import { describe, expect, it } from "vitest"
import { parseDynamicCollectionFeedPage } from "./dynamic-collection-contract"

const section = {
  id: "one",
  slug: "jesus",
  title: "Jesus",
  description: null,
  items: [],
}
const surfaceManifest = {
  manifest: {
    surface: "watch-home",
    block: "authored",
    presentation: "authored-block",
    placement: "dynamic-one",
    policyVersion: "watch-exposure-v2",
    items: [{ position: 0, itemPath: "/watch/jesus.html" }],
    sourceVersion: "a".repeat(64),
    expiresAt: "2026-09-30T00:00:00.000Z",
  },
  signature: "a".repeat(43),
}
const page = { sections: [section], endCursor: null, hasNextPage: false }

describe("optional dynamic collection source authority", () => {
  it("preserves a bounded signed descriptor without changing content or pagination", () => {
    expect(
      parseDynamicCollectionFeedPage({
        ...page,
        sections: [{ ...section, surfaceManifest }],
      }),
    ).toEqual({ ...page, sections: [{ ...section, surfaceManifest }] })
  })
  it("drops malformed or mismatched optional authority without breaking the legacy feed", () => {
    for (const invalid of [
      null,
      {},
      { ...surfaceManifest, signature: "bad" },
      {
        ...surfaceManifest,
        manifest: { ...surfaceManifest.manifest, placement: "a".repeat(65) },
      },
      {
        ...surfaceManifest,
        manifest: { ...surfaceManifest.manifest, block: "hero" },
      },
      {
        ...surfaceManifest,
        manifest: { ...surfaceManifest.manifest, identity: "forbidden" },
      },
    ])
      expect(
        parseDynamicCollectionFeedPage({
          ...page,
          sections: [{ ...section, surfaceManifest: invalid }],
        }),
      ).toEqual(page)
    expect(parseDynamicCollectionFeedPage(page)).toEqual(page)
  })
})
