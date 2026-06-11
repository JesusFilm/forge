import { print } from "graphql"
import { describe, expect, it } from "vitest"

import {
  getWatchVideoDubDetailOperation,
  getWatchVideoLocalizedCopyBySlugOperation,
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
    expect(printed).toMatch(/variants\s*:\s*dubs\s*\{/)
    expect(printed).toMatch(/variants\s*:\s*dubs\s*\{[\s\S]*?\bhls\b/)
    expect(printed).toMatch(/variants\s*:\s*dubs\s*\{[\s\S]*?\bduration\b/)
    expect(printed).toMatch(
      /variants\s*:\s*dubs\s*\{[\s\S]*?language\s*\{[\s\S]*?coreId[\s\S]*?bcp47[\s\S]*?\bslug\b[\s\S]*?\bname\b/,
    )

    expect(printed).not.toMatch(/\blocales\(/)
    expect(printed).not.toMatch(/\bstudyQuestions\(/)
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
    expect(printed).toMatch(/\blanguage\s*\{[\s\S]*?coreId[\s\S]*?slug/)
    expect(printed).toMatch(/\bdownloads\s*\{[\s\S]*?quality[\s\S]*?size/)
    expect(printed).toMatch(/\bmuxVideo\s*\{[\s\S]*?playbackId/)
    expect(printed).toMatch(
      /\bvideoEdition\s*\{[\s\S]*?subtitles\s*\{[\s\S]*?vttSrc[\s\S]*?srtSrc[\s\S]*?primary[\s\S]*?aiGenerated/,
    )
  })
})

describe("WatchVideo split operation documents", () => {
  it("declares only videoSlug for the shell lookup", () => {
    const printed = print(getWatchVideoShellBySlugOperation)

    expect(printed).toMatch(
      /query GetWatchVideoShellBySlug\(\$videoSlug:\s*String!\)/,
    )
    expect(printed).toMatch(/videoBySlug\(slug:\s*\$videoSlug\)/)
    expect(printed).toMatch(/\.\.\.WatchVideoShell\b/)
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
