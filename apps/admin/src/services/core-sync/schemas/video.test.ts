import { describe, expect, it } from "vitest"

import { CoreVideoSchema } from "./video"

describe("CoreVideoSchema", () => {
  it("accepts localized language refs with null BCP-47", () => {
    expect(
      CoreVideoSchema.safeParse({
        id: "video-1",
        slug: "video",
        label: null,
        publishedAt: null,
        primaryLanguageId: null,
        source: null,
        origin: null,
        title: [
          {
            value: "Title",
            language: { id: "language-without-bcp47", bcp47: null },
          },
        ],
        description: [],
        snippet: [],
        studyQuestions: [],
        imageAlt: [],
        bibleCitations: [],
        keywords: [],
        children: [],
        locked: false,
        noIndex: false,
        restrictViewPlatforms: [],
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).success,
    ).toBe(true)
  })
})
