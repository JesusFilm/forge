import { print } from "graphql"
import { describe, expect, it } from "vitest"

import {
  getWatchCollectionDownloadDubsBySlugOperation,
  getWatchVideoCarouselMuxPlaybackIdsBySlugOperation,
  getWatchLanguagePickerVariantsBySlugOperation,
  getWatchVideoDubDetailOperation,
  getWatchVideoLocalizedCopyBySlugOperation,
  getWatchVideoRouteSnapshotBySlugOperation,
  getWatchVideoShellBySlugOperation,
  watchVideoDubDetailFragment,
  watchVideoLocalizedCopyFragment,
  watchVideoShellFragment,
} from "@/lib/fragments/watch-video"

describe("WatchVideo split GraphQL operations", () => {
  it("keeps the slug-level shell free of localized copy and heavy Dub detail", () => {
    const printed = print(watchVideoShellFragment)

    expect(printed).toMatch(/fragment WatchVideoShell on Video/)
    expect(printed).toMatch(/documentId\s*:\s*\bid\b/)
    expect(printed).toMatch(/\bslug\b/)
    expect(printed).toMatch(/\bnoIndex\b/)
    expect(printed).toMatch(/\blabel\b/)
    expect(printed).toMatch(/images\s*\{[\s\S]*?\burl\b/)
    expect(printed).toMatch(/primaryLanguage\s*\{[\s\S]*?coreId[\s\S]*?bcp47/)
    expect(printed).toMatch(/parents\s*\{[\s\S]*?parent\s*\{/)
    expect(printed).toMatch(/children\s*\{[\s\S]*?child\s*\{/)
    expect(printed).toMatch(/children\s*\{\s*order\s+child\s*\{/)
    expect(printed).not.toMatch(/\blocales\(/)
    expect(printed).not.toMatch(/\bstudyQuestions\(/)
    expect(printed).not.toMatch(/\bdubs\s*\{/)
    expect(printed).not.toMatch(/\bdownloads\s*\{/)
    expect(printed).not.toMatch(/\bmuxVideo\s*\{/)
    expect(printed).not.toMatch(/\bvideoEdition\s*\{/)
  })

  it("keeps localized fallback queries text-only", () => {
    const printed = print(watchVideoLocalizedCopyFragment)

    expect(printed).toMatch(/fragment WatchVideoLocalizedCopy on Video/)
    expect(printed).toMatch(
      /locales\(locale:\s*\$locale,\s*languageSlug:\s*\$languageSlug\)/,
    )
    expect(printed).toMatch(
      /locales\([^)]*\)\s*\{[\s\S]*?\btitle\b[\s\S]*?description[\s\S]*?snippet[\s\S]*?imageAlt/,
    )
    expect(printed).toMatch(
      /studyQuestions\(locale:\s*\$locale,\s*languageSlug:\s*\$languageSlug\)\s*\{/,
    )
    expect(printed).toMatch(
      /studyQuestions\([^)]*\)\s*\{[\s\S]*?value\s*:\s*text/,
    )
    expect(printed).toMatch(/parents\s*\{[\s\S]*?locales\(/)
    expect(printed).toMatch(/children\s*\{[\s\S]*?locales\(/)
    expect(printed).toMatch(/children\s*\{\s*order\s+child\s*\{/)

    expect(printed).not.toMatch(/\bdubs\s*\{/)
    expect(printed).not.toMatch(/\bdownloads\s*\{/)
    expect(printed).not.toMatch(/\bmuxVideo\s*\{/)
    expect(printed).not.toMatch(/\bvideoEdition\s*\{/)
  })

  it("loads downloads, mux playback, and subtitles only for one selected Dub", () => {
    const printed = print(watchVideoDubDetailFragment)

    expect(printed).toMatch(/fragment WatchVideoDubDetail on VideoDub/)
    expect(printed).toMatch(/documentId\s*:\s*\bid\b/)
    expect(printed).toMatch(/\bhls\b/)
    expect(printed).toMatch(/\bduration\b/)
    expect(printed).toMatch(
      /\blanguage\s*\{[\s\S]*?coreId[\s\S]*?iso3[\s\S]*?slug/,
    )
    expect(printed).toMatch(
      /\bdownloads\s*\{[\s\S]*?height[\s\S]*?quality[\s\S]*?size/,
    )
    expect(printed).toMatch(/\bmuxVideo\s*\{[\s\S]*?playbackId/)
    expect(printed).toMatch(
      /\bvideoEdition\s*\{[\s\S]*?subtitles\s*\{[\s\S]*?vttSrc[\s\S]*?srtSrc[\s\S]*?primary[\s\S]*?aiGenerated/,
    )
    expect(printed).toMatch(
      /\bsubtitles\s*\{[\s\S]*?\bvideo\s*\{[\s\S]*?documentId\s*:\s*\bid\b/,
    )
  })
})

describe("WatchVideo split operation documents", () => {
  it("keeps collection source URLs inside the server-only lookup", () => {
    const printed = print(getWatchCollectionDownloadDubsBySlugOperation)

    expect(printed).toMatch(
      /downloadableChildDubs\(languageSlug:\s*\$languageSlug\)/,
    )
    expect(printed).toMatch(/downloads\s*\{/)
    expect(printed).toMatch(/documentId\s*:\s*id/)
    expect(printed).toMatch(/\burl\b/)
  })

  it("declares only videoSlug for the stable shell lookup", () => {
    const printed = print(getWatchVideoShellBySlugOperation)

    expect(printed).toMatch(
      /query GetWatchVideoShellBySlug\(\$videoSlug:\s*String!\)/,
    )
    expect(printed).toMatch(/videoBySlug\(slug:\s*\$videoSlug\)/)
    expect(printed).not.toMatch(/muxPlaybackId/)
    expect(printed).toMatch(/\.\.\.WatchVideoShell\b/)
  })

  it("uses the dedicated route snapshot field for the cold watch route", () => {
    const printed = print(getWatchVideoRouteSnapshotBySlugOperation)

    expect(printed).toMatch(
      /watchVideoRouteSnapshotBySlug\(\s*slug:\s*\$videoSlug\s*locale:\s*\$locale\s*languageSlug:\s*\$languageSlug\s*subtitleLanguageSlug:\s*\$subtitleLanguageSlug\s*\)/,
    )
    expect(printed).toMatch(/\bpublishedAt\b/)
    expect(printed).toMatch(/\bexactLocales\b/)
    expect(printed).toMatch(/\bbroadLocales\b/)
    expect(printed).toMatch(/\benglishLocales\b/)
    expect(printed).toMatch(/\bsearchTitle\b/)
    expect(printed).toMatch(/\bsearchDescription\b/)
    expect(printed).toMatch(
      /\bsocialImage\s*\{[\s\S]*?\burl\b[\s\S]*?\bwidth\b[\s\S]*?\bheight\b/,
    )
    const parentAndChildProjection = printed.slice(
      printed.indexOf("parents"),
      printed.indexOf("bibleCitations"),
    )
    expect(parentAndChildProjection).not.toMatch(/\bsearchTitle\b/)
    expect(parentAndChildProjection).not.toMatch(/\bsearchDescription\b/)
    expect(parentAndChildProjection).not.toMatch(/\bsocialImage\b/)
    expect(printed).toMatch(/\bexactStudyQuestions\b/)
    expect(printed).toMatch(/\bmuxPlaybackId\b/)
    expect(printed).toMatch(/\bplayableDubLanguageCount\b/)
    expect(printed).toMatch(/\bpreferredVariant\b/)
    expect(parentAndChildProjection).toMatch(
      /children\s*\{\s*order\s+child\s*\{/,
    )
    expect(printed).not.toMatch(/videoBySlug\(slug:\s*\$videoSlug\)/)
    expect(printed).not.toMatch(/\.\.\.WatchVideoShell\b/)
    expect(printed).not.toMatch(/\blocales\(/)
    expect(printed).not.toMatch(/\bstudyQuestions\(/)
    expect(printed).not.toMatch(/preferredPlayableDub\(/)
    expect(printed).not.toMatch(/variants\s*:\s*dubs\s*\{/)
    expect(printed).not.toMatch(/\bdownloads\s*\{/)
    expect(printed).not.toMatch(/\bvideoEdition\s*\{/)
  })

  it("fetches optional carousel Mux playback ids by languageSlug", () => {
    const printed = print(getWatchVideoCarouselMuxPlaybackIdsBySlugOperation)

    expect(printed).toMatch(/\$videoSlug:\s*String!/)
    expect(printed).toMatch(/\$languageSlug:\s*String\b/)
    expect(printed).toMatch(/videoBySlug\(slug:\s*\$videoSlug\)/)
    expect(printed).toMatch(/muxPlaybackId\(languageSlug:\s*\$languageSlug\)/)
  })

  it("keeps the full dub list isolated to the lazy language-picker lookup", () => {
    const printed = print(getWatchLanguagePickerVariantsBySlugOperation)

    expect(printed).toMatch(
      /query GetWatchLanguagePickerVariantsBySlug\(\$videoSlug:\s*String!\)/,
    )
    expect(printed).toMatch(/videoBySlug\(slug:\s*\$videoSlug\)/)
    expect(printed).toMatch(/variants\s*:\s*dubs\s*\{/)
    expect(printed).toMatch(/variants\s*:\s*dubs\s*\{[\s\S]*?\bhls\b/)
    expect(printed).toMatch(/variants\s*:\s*dubs\s*\{[\s\S]*?\bduration\b/)
    expect(printed).toMatch(
      /variants\s*:\s*dubs\s*\{[\s\S]*?language\s*\{[\s\S]*?coreId[\s\S]*?bcp47[\s\S]*?\bslug\b[\s\S]*?\bname\b/,
    )
    expect(printed).not.toMatch(/\bdownloads\s*\{/)
    expect(printed).not.toMatch(/\bmuxVideo\s*\{/)
    expect(printed).not.toMatch(/\bvideoEdition\s*\{/)
  })

  it("threads locale and languageSlug only into the copy lookup", () => {
    const printed = print(getWatchVideoLocalizedCopyBySlugOperation)

    expect(printed).toMatch(/\$locale:\s*String!/)
    expect(printed).toMatch(/\$languageSlug:\s*String\b/)
    expect(printed).toMatch(/\$videoSlug:\s*String!/)
    expect(printed).toMatch(/\.\.\.WatchVideoLocalizedCopy\b/)
  })

  it("fetches selected Dub detail by id", () => {
    const printed = print(getWatchVideoDubDetailOperation)

    expect(printed).toMatch(/query GetWatchVideoDubDetail\(\$id:\s*ID!\)/)
    expect(printed).toMatch(/videoDub\(id:\s*\$id\)/)
    expect(printed).toMatch(/\.\.\.WatchVideoDubDetail\b/)
  })
})
