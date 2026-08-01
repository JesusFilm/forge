import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

import { parseJesusFilmCatalogDocument } from "./jesus-film-catalog"
import { createLocalVideoMatcher } from "./local-video-matcher"
import type { DevotionalLlm } from "./llm"
import type { Hook, ScriptureRef } from "./types"

const SCRIPTURE: ScriptureRef = {
  reference: "Luke 2:7",
  text: "And she gave birth to her firstborn son and laid him in a manger.",
  translation: "ESV",
  needsCanonicalSource: true,
}
const HOOK: Hook = {
  type: "holiday",
  title: "Christmas Day",
  summary: "The birth of Jesus.",
  sourceUrl: null,
}

function fakeLlm(pick: unknown): DevotionalLlm {
  return { model: "fake", complete: async () => pick as never }
}

const JESUS_FILM_CHAPTERS = parseJesusFilmCatalogDocument({
  path: "/inputs/video/jesus-film-catalog.json",
  content: readFileSync(
    path.resolve("devotional-workspace/inputs/video/jesus-film-catalog.json"),
    "utf8",
  ),
})
const AUTHORED = {
  catalog: JESUS_FILM_CHAPTERS,
  systemPrompt: "Select the most relevant JESUS-film chapter and return JSON.",
}

describe("jesus-film-catalog", () => {
  it("has exactly 61 chapters with sequential ids", () => {
    expect(JESUS_FILM_CHAPTERS).toHaveLength(61)
    expect(JESUS_FILM_CHAPTERS[0]).toMatchObject({
      index: 1,
      id: "1_jf6101-0-0",
      title: "The Beginning",
    })
    expect(JESUS_FILM_CHAPTERS[61 - 1]).toMatchObject({
      index: 61,
      id: "1_jf6161-0-0",
      title: "Invitation to Know Jesus Personally",
    })
    JESUS_FILM_CHAPTERS.forEach((c, i) => expect(c.index).toBe(i + 1))
  })
})

describe("createLocalVideoMatcher", () => {
  it("maps the LLM's chosen index to that chapter, marked search", async () => {
    const match = createLocalVideoMatcher({
      llm: fakeLlm({ index: 2 }),
      ...AUTHORED,
    })
    const result = await match({ scripture: SCRIPTURE, hook: HOOK })
    expect(result.videoMatch).toBe("search")
    expect(result.video).toMatchObject({
      videoId: "1_jf6102-0-0",
      title: "Birth of Jesus",
      url: "1_jf6102-0-0",
    })
  })

  it("falls back by keyword overlap when the LLM index is out of range", async () => {
    const match = createLocalVideoMatcher({
      llm: fakeLlm({ index: 999 }),
      ...AUTHORED,
    })
    const result = await match({ scripture: SCRIPTURE, hook: HOOK })
    expect(result.videoMatch).toBe("fallback")
    expect(result.video).not.toBeNull()
  })

  it("falls back when the LLM throws (e.g. transport)", async () => {
    const llm: DevotionalLlm = {
      model: "fake",
      complete: async () => {
        throw new Error("boom")
      },
    }
    const match = createLocalVideoMatcher({ llm, ...AUTHORED })
    const result = await match({ scripture: SCRIPTURE, hook: HOOK })
    expect(result.videoMatch).toBe("fallback")
    expect(result.video).not.toBeNull()
  })

  it("keyword fallback prefers a title that shares words with the hook", async () => {
    // "Triumphal Entry" hook should keyword-match the matching chapter title.
    const llm: DevotionalLlm = {
      model: "fake",
      complete: async () => {
        throw new Error("force fallback")
      },
    }
    const match = createLocalVideoMatcher({ llm, ...AUTHORED })
    const result = await match({
      scripture: { ...SCRIPTURE, reference: "Luke 19:38" },
      hook: { ...HOOK, title: "Triumphal Entry into Jerusalem" },
    })
    expect(result.video?.title).toContain("Triumphal Entry")
  })

  it("fails before provider construction when authored catalog/prompt are absent", () => {
    expect(() => createLocalVideoMatcher()).toThrow(
      "/inputs/video/jesus-film-catalog.json",
    )
    expect(() =>
      createLocalVideoMatcher({ catalog: JESUS_FILM_CHAPTERS }),
    ).toThrow("/inputs/prompts/generation.json")
  })
})
