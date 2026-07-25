import { print } from "graphql"
import type { DocumentNode } from "graphql"

import {
  GET_SHOWCASE_SUBTITLE,
  GET_SHOWCASE_VIDEO,
  createShowcaseVideoFetcher,
} from "./showcaseVideoQuery"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const printed = asSdl(GET_SHOWCASE_VIDEO)

describe("GET_SHOWCASE_VIDEO — lean per-video stream query", () => {
  // KTD-4's whole reason for a showcase-specific operation: watchVideoFragment's
  // parents → parent → children chain costs ~208 nodes / ~1.6s per video of data
  // the reel never renders.
  it("selects NO parents/children chain", () => {
    expect(printed).not.toMatch(/\bparents\b/)
    expect(printed).not.toMatch(/\bchildren\b/)
  })

  it("selects none of the watch screen's unused tails", () => {
    expect(printed).not.toMatch(/\bstudyQuestions\b/)
    expect(printed).not.toMatch(/\bbibleCitations\b/)
    expect(printed).not.toMatch(/\bdownloads\b/)
    expect(printed).not.toMatch(/\bsubtitles\b/)
  })

  it("queries the public videoBySlug root and declares $slug/$locale", () => {
    expect(printed).toContain("query GetShowcaseVideo")
    expect(printed).toContain("videoBySlug(slug: $slug)")
    expect(printed).toContain("$slug: String!")
    expect(printed).toContain("$locale: String!")
  })

  // R13/AE12's invariant, inherited: consumer apps use ONLY public admin fields,
  // never the editor-gated `experiences` list.
  it("touches no editor-gated field", () => {
    expect(printed).not.toMatch(/\bexperiences\b/)
  })

  it("selects the dub fields the reel actually plays", () => {
    expect(printed).toMatch(/\bdubs\b/)
    expect(printed).toMatch(/\bpublished\b/)
    expect(printed).toMatch(/\bhls\b/)
    expect(printed).toMatch(/\bduration\b/)
    expect(printed).toMatch(/\bplaybackId\b/)
  })

  // Preference identity stays language.slug (bcp47 collides: ko/ko-kmr), but bcp47 is
  // now selected too — it feeds resolveDefaultSlug's device-locale + English prefix rungs
  // when the viewer's language is absent. Without it the default chain degrades to first-dub.
  it("selects language.slug, name, and bcp47", () => {
    expect(printed).toMatch(/\bslug\b/)
    expect(printed).toMatch(/\bname\b/)
    expect(printed).toMatch(/\bbcp47\b/)
  })

  it("selects the poster-intent image fields", () => {
    for (const field of [
      "mobileCinematicHigh",
      "mobileCinematicLow",
      "thumbnail",
    ]) {
      expect(printed).toContain(field)
    }
  })
})

describe("GET_SHOWCASE_SUBTITLE — lean sentence-timing query (KTD-2)", () => {
  const subtitleSdl = asSdl(GET_SHOWCASE_SUBTITLE)

  it("resolves the English dub's edition subtitles via the public videoBySlug root", () => {
    expect(subtitleSdl).toContain("query GetShowcaseSubtitle")
    expect(subtitleSdl).toContain("videoBySlug(slug: $slug)")
    expect(subtitleSdl).toContain(
      'preferredPlayableDub(languageSlug: "english")',
    )
    for (const field of [
      "videoEdition",
      "subtitles",
      "vttSrc",
      "primary",
      "aiGenerated",
    ]) {
      expect(subtitleSdl).toMatch(new RegExp(`\\b${field}\\b`))
    }
  })

  it("touches no editor-gated field, no bulk dub list, and no heavy chain", () => {
    expect(subtitleSdl).not.toMatch(/\bexperiences\b/)
    expect(subtitleSdl).not.toMatch(/\bparents\b/)
    expect(subtitleSdl).not.toMatch(/\bdubs\b/) // the bulk ~2,250-field list stays off this query
  })
})

describe("createShowcaseVideoFetcher", () => {
  const videoBySlug = {
    documentId: "doc-a",
    slug: "a-slug",
    dubs: [{ published: true, hls: "https://stream/en.m3u8" }],
  }

  function fakeClient(result: unknown) {
    return {
      query: jest.fn(async () => result),
    } as unknown as Parameters<typeof createShowcaseVideoFetcher>[0]
  }

  it("queries by slug with the hardcoded English locale", async () => {
    const client = fakeClient({ data: { videoBySlug } })
    await createShowcaseVideoFetcher(client)("a-slug")
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { locale: "en", slug: "a-slug" },
        fetchPolicy: "cache-first",
      }),
    )
  })

  it("returns the video so its dubs reach the rotation policy", async () => {
    const client = fakeClient({ data: { videoBySlug } })
    const result = await createShowcaseVideoFetcher(client)("a-slug")
    expect(result?.dubs).toEqual(videoBySlug.dubs)
  })

  it("returns null for an unknown slug", async () => {
    const client = fakeClient({ data: { videoBySlug: null } })
    expect(await createShowcaseVideoFetcher(client)("gone")).toBeNull()
  })

  it("returns null when the response carries no data", async () => {
    const client = fakeClient({ data: null })
    expect(await createShowcaseVideoFetcher(client)("a-slug")).toBeNull()
  })

  // A loop-boundary refresh needs to bypass the cache; the default stays cache-first
  // so a revisited video across loops does not refetch.
  it("honours an explicit fetch policy", async () => {
    const client = fakeClient({ data: { videoBySlug } })
    await createShowcaseVideoFetcher(client, "network-only")("a-slug")
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({ fetchPolicy: "network-only" }),
    )
  })

  // R16: the caller treats a throw as "skip this item", but resolveExcerptStream's
  // guard is the only thing standing between an Apollo reject and the reel.
  it("propagates a rejected query for resolveExcerptStream to catch", async () => {
    const client = {
      query: jest.fn(async () => {
        throw new Error("network down")
      }),
    } as unknown as Parameters<typeof createShowcaseVideoFetcher>[0]
    await expect(createShowcaseVideoFetcher(client)("a-slug")).rejects.toThrow(
      "network down",
    )
  })
})
