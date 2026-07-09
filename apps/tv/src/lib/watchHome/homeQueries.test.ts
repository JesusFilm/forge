import { print } from "graphql"
import type { DocumentNode } from "graphql"

import { GET_WATCH_HOME_VIDEOS, GET_WATCH_SETTING } from "./homeQueries"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const printed = asSdl(GET_WATCH_HOME_VIDEOS)
const printedSetting = asSdl(GET_WATCH_SETTING)

describe("GET_WATCH_HOME_VIDEOS — lean payload guard", () => {
  // Regression guard for the 2,259-dub / 9.5MB payload incident: the bulk
  // home fragment must NEVER project dubs/variants (or their media). Playable
  // streams resolve lazily at selection time instead.
  it("selects no dubs anywhere (the 9.5MB bulk-payload trap stays fixed)", () => {
    expect(printed).not.toMatch(/\bdubs\b/)
    expect(printed).not.toMatch(/\bvariants\b/)
    expect(printed).not.toMatch(/\bdownloads\b/)
    expect(printed).not.toMatch(/\bsubtitles\b/)
  })

  it("does not select childDubLanguages (a series-screen concern, not home)", () => {
    expect(printed).not.toMatch(/\bchildDubLanguages\b/)
  })

  it("selects watchHomeVideos and declares $coreIds/$locale/$languageSlug", () => {
    expect(printed).toContain("query GetWatchHomeVideos")
    expect(printed).toContain("watchHomeVideos(coreIds: $coreIds)")
    expect(printed).toContain("$coreIds: [String!]!")
    expect(printed).toContain("$locale: String!")
    expect(printed).toMatch(/\$languageSlug: String(?!!)/)
  })

  it("selects the routing identity (coreId) on parents and children", () => {
    expect(printed.match(/\bcoreId\b/g)).toHaveLength(2)
  })

  it("narrows locales by the locale pair on parents and children", () => {
    const localeSelections = printed.match(
      /locales\(locale: \$locale, languageSlug: \$languageSlug\)/g,
    )
    expect(localeSelections).toHaveLength(2)
  })

  it("fetches exactly one level of children (no grandchildren)", () => {
    expect(printed.match(/\bchildren\b/g)).toHaveLength(1)
    expect(printed).toContain("child {")
  })
})

describe("GET_WATCH_SETTING — public home Experience query + doc guard (AE12)", () => {
  it("resolves the home body via the PUBLIC watchSetting field", () => {
    expect(printedSetting).toContain("query GetWatchSetting")
    expect(printedSetting).toContain("watchSetting(locale: $locale)")
    expect(printedSetting).toContain("homepageExperience")
  })

  // R13: TV Home uses only public admin queries. The editor-gated `experiences`
  // list field must never appear, or the home query fails auth in prod.
  it("does NOT reference the editor-gated experiences list field", () => {
    expect(printedSetting).not.toMatch(/\bexperiences\b/)
  })

  // R17/R3: hydration keys on the item's coreId. A missing coreId selection
  // silently strands every Experience item (nothing hydrates) — guard it.
  it("selects coreId on the MediaCollection items (the hydration key)", () => {
    expect(printedSetting).toMatch(/items\s*\{[^}]*\bcoreId\b/)
  })
})
