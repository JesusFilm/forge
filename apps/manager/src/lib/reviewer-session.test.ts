import { describe, expect, it } from "vitest"

import {
  hasReviewerLanguageGrant,
  parseReviewerLanguageGrants,
} from "./reviewer-session"

describe("reviewer language session grants", () => {
  it("authorizes only an exact Admin language id and slug pair", () => {
    const grants = parseReviewerLanguageGrants([
      {
        id: "grant-es",
        languageId: "language-es",
        languageSlug: "spanish-latin-america",
        languageBcp47: "es-419",
        permittedRubricDimensions: ["MEANING_ACCURACY"],
        specialistCapabilities: { scripture: false, theology: false },
      },
    ])

    expect(grants).not.toBeNull()
    expect(
      hasReviewerLanguageGrant(grants!, "language-es", "spanish-latin-america"),
    ).toBe(true)
    expect(
      hasReviewerLanguageGrant(
        grants!,
        "different-language-with-same-bcp47",
        "spanish-latin-america",
      ),
    ).toBe(false)
  })

  it("fails closed for malformed or duplicate grant identities", () => {
    const grant = {
      id: "grant-es",
      languageId: "language-es",
      languageSlug: "spanish-latin-america",
      permittedRubricDimensions: ["MEANING_ACCURACY"],
      specialistCapabilities: { scripture: false, theology: false },
    }
    expect(
      parseReviewerLanguageGrants([grant, { ...grant, id: "other" }]),
    ).toBe(null)
  })
})
