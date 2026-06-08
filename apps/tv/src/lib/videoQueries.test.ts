import { print } from "graphql"
import type { DocumentNode } from "graphql"

import {
  GET_VIDEO_BY_SLUG,
  GET_VIDEO_DUB,
  watchVideoFragment,
  watchDubMediaFragment,
} from "./videoQueries"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const bulkSdl = asSdl(GET_VIDEO_BY_SLUG)
const dubSdl = asSdl(GET_VIDEO_DUB)
const bulkFragmentSdl = asSdl(watchVideoFragment)
const dubFragmentSdl = asSdl(watchDubMediaFragment)

describe("GET_VIDEO_BY_SLUG (lean bulk video + dub list)", () => {
  it("queries the videoBySlug root field", () => {
    expect(bulkSdl).toContain("videoBySlug")
  })

  it("passes slug to videoBySlug but NOT locale (locale is nested-only)", () => {
    // videoBySlug itself takes only slug; $locale is consumed by nested
    // locales(locale:) selections, never as a videoBySlug argument.
    expect(bulkSdl).toMatch(/videoBySlug\(slug:\s*\$slug\)/)
    expect(bulkSdl).not.toMatch(/videoBySlug\([^)]*locale/)
  })

  it("declares both $locale and $slug variables", () => {
    expect(bulkSdl).toContain("$locale: String!")
    expect(bulkSdl).toContain("$slug: String!")
  })

  it("selects the lean per-dub fields under variants: dubs", () => {
    expect(bulkSdl).toContain("variants: dubs")
    for (const field of [
      "documentId: id",
      "slug",
      "published",
      "hls",
      "duration",
      "playbackId",
    ]) {
      expect(bulkSdl).toContain(field)
    }
  })

  it("selects siblings via parents.parent.children.child", () => {
    expect(bulkSdl).toContain("parents")
    expect(bulkSdl).toContain("parent")
    expect(bulkSdl).toContain("children")
    expect(bulkSdl).toContain("child")
  })

  it("selects study questions and bible citations (incl. bibleBook name)", () => {
    expect(bulkSdl).toContain("studyQuestions")
    expect(bulkSdl).toContain("bibleCitations")
    expect(bulkSdl).toContain("bibleBook")
  })

  it("consumes $locale only via nested locales(locale: $locale) selections", () => {
    expect(bulkSdl).toMatch(/locales\(locale:\s*\$locale\)/)
  })

  // Payload-regression guard (covers AE6): inlining per-dub media here is what
  // blew up the birth-of-jesus payload to ~9.5MB. These MUST stay out of the
  // bulk fragment — they belong to the lazy GET_VIDEO_DUB query only.
  it("EXCLUDES per-dub downloads from the bulk selection", () => {
    expect(bulkSdl).not.toContain("downloads")
    expect(bulkFragmentSdl).not.toContain("downloads")
  })

  it("EXCLUDES videoEdition.subtitles from the bulk selection", () => {
    expect(bulkSdl).not.toContain("videoEdition")
    expect(bulkSdl).not.toContain("subtitles")
    expect(bulkFragmentSdl).not.toContain("videoEdition")
    expect(bulkFragmentSdl).not.toContain("subtitles")
  })
})

describe("GET_VIDEO_DUB (lazy per-dub media)", () => {
  it("queries the videoDub(id:) root field", () => {
    expect(dubSdl).toContain("videoDub")
    expect(dubSdl).toMatch(/videoDub\(id:\s*\$id\)/)
  })

  it("declares the $id: ID! variable", () => {
    expect(dubSdl).toContain("$id: ID!")
  })

  it("INCLUDES per-dub downloads (quality, size, url)", () => {
    expect(dubSdl).toContain("downloads")
    for (const field of ["quality", "size", "url"]) {
      expect(dubSdl).toContain(field)
    }
  })

  it("INCLUDES videoEdition.subtitles (vttSrc, primary, aiGenerated)", () => {
    expect(dubSdl).toContain("videoEdition")
    expect(dubSdl).toContain("subtitles")
    for (const field of ["vttSrc", "primary", "aiGenerated"]) {
      expect(dubSdl).toContain(field)
    }
    expect(dubFragmentSdl).toContain("subtitles")
  })
})
