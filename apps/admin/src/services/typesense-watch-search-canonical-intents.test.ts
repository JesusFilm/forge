import { describe, expect, it } from "vitest"

import {
  createWatchSearchCanonicalIntentResolver,
  resolveWatchSearchCanonicalIntent,
} from "./typesense-watch-search-canonical-intents"

describe("Watch search canonical intents", () => {
  it.each(["Jesus for kids", "Jesus for children", " JESUS-for-KIDS! "])(
    "resolves the reviewed English alias %s to stable Core identity",
    (query) => {
      expect(resolveWatchSearchCanonicalIntent(query, "english")).toEqual({
        targetCanonicalVideoId: "core:1_cl-0-0",
      })
    },
  )

  it("keeps aliases language-scoped and unknown phrases inert", () => {
    expect(resolveWatchSearchCanonicalIntent("Jesus for kids", "french")).toBe(
      null,
    )
    expect(resolveWatchSearchCanonicalIntent("Jesus for kids", null)).toBe(null)
    expect(resolveWatchSearchCanonicalIntent("resurrection", "english")).toBe(
      null,
    )
  })

  it("rejects normalized alias collisions even when entries name different owners", () => {
    expect(() =>
      createWatchSearchCanonicalIntentResolver([
        {
          languageSlug: "english",
          aliases: ["Jesus for kids"],
          targetCanonicalVideoId: "core:first",
        },
        {
          languageSlug: "english",
          aliases: ["jesus-for-kids"],
          targetCanonicalVideoId: "core:second",
        },
      ]),
    ).toThrow(/collision.*english.*jesus for kids/i)
  })

  it.each([
    {
      languageSlug: "",
      aliases: ["Jesus for kids"],
      targetCanonicalVideoId: "core:first",
    },
    {
      languageSlug: "english",
      aliases: [],
      targetCanonicalVideoId: "core:first",
    },
    {
      languageSlug: "english",
      aliases: ["  "],
      targetCanonicalVideoId: "core:first",
    },
    {
      languageSlug: "english",
      aliases: ["Jesus for kids"],
      targetCanonicalVideoId: "video:first",
    },
  ])("rejects invalid catalog entry %#", (entry) => {
    expect(() => createWatchSearchCanonicalIntentResolver([entry])).toThrow()
  })
})
