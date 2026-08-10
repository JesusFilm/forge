import { print } from "graphql"

import { GET_WATCH_VIDEOS_BY_IDS } from "../../lib/queries"

describe("useVideoThumbnails query contract", () => {
  const query = print(GET_WATCH_VIDEOS_BY_IDS)

  it("uses the bounded typed Watch batch resolver", () => {
    expect(query).toContain("query GetWatchVideosByIds($ids: [ID!]!)")
    expect(query).toContain("watchVideosByIds(ids: $ids)")
    expect(query).not.toMatch(/v\d+:\s*video\(/)
  })

  it("loads both public English title identities", () => {
    expect(query).toContain('locales(locale: "en")')
    expect(query).toContain(
      'englishLanguageTitleLocales: locales(languageSlug: "english")',
    )
  })
})
