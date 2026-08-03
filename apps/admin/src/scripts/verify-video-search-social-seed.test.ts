import { describe, expect, it } from "vitest"
import {
  JESUS_SEARCH_DESCRIPTION,
  JESUS_SEARCH_TITLE,
  verifyJesusSearchSocialSeed,
} from "./verify-video-search-social-seed"

const candidate = {
  id: "locale-en",
  videoId: "video-jesus",
  languageCoreId: "529",
  searchTitle: JESUS_SEARCH_TITLE,
  searchDescription: JESUS_SEARCH_DESCRIPTION,
  socialImageAssetId: null,
  video: { coreId: "1_jf-0-0", slug: "jesus" },
}

describe("verifyJesusSearchSocialSeed", () => {
  it("accepts exactly one canonical row with the approved copy and no image", () => {
    expect(verifyJesusSearchSocialSeed([candidate])).toMatchObject({ ok: true })
  })

  it("fails with diagnostic checks for missing, duplicate, or drifted rows", () => {
    expect(verifyJesusSearchSocialSeed([])).toMatchObject({
      ok: false,
      checks: { exactlyOneCandidate: false },
    })
    expect(verifyJesusSearchSocialSeed([candidate, candidate])).toMatchObject({
      ok: false,
      checks: { exactlyOneCandidate: false },
    })
    expect(
      verifyJesusSearchSocialSeed([
        { ...candidate, searchTitle: "Wrong", socialImageAssetId: "asset-1" },
      ]),
    ).toMatchObject({
      ok: false,
      checks: { searchTitle: false, noSocialImageOverride: false },
    })
  })
})
