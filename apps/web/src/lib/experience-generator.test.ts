import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ExperienceGeneratorError,
  generateExperience,
  type CompactResult,
} from "./experience-generator"

const results: CompactResult[] = [
  { slug: "easter", title: "Easter", snippet: "The story of the resurrection" },
  { slug: "jesus", title: "Jesus", snippet: "The full-length feature" },
  { slug: "the-passover", title: "The Passover", snippet: "Exodus story" },
  {
    slug: "the-last-supper",
    title: "The Last Supper",
    snippet: "Scene from Jesus",
  },
  {
    slug: "empty-tomb",
    title: "Empty Tomb",
    snippet: "Resurrection morning",
  },
]

function mockOpenRouterJsonContent(experience: unknown) {
  global.fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(experience) } }],
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch
}

describe("generateExperience", () => {
  const origKey = process.env.OPENROUTER_API_KEY

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "sk-test"
  })

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = origKey
    vi.restoreAllMocks()
  })

  it("throws NOT_CONFIGURED when the API key is missing", async () => {
    delete process.env.OPENROUTER_API_KEY
    await expect(generateExperience("easter", results)).rejects.toMatchObject({
      name: "ExperienceGeneratorError",
      code: "NOT_CONFIGURED",
    })
  })

  it("returns a validated + filtered experience on a well-formed response", async () => {
    mockOpenRouterJsonContent({
      title: "Easter: the story of hope",
      intro: "A look at the resurrection across our catalog.",
      sections: [
        {
          type: "spotlight",
          videoSlug: "easter",
          why: "The lead Easter film.",
        },
        {
          type: "theme-carousel",
          theme: "The Resurrection",
          videoSlugs: ["the-last-supper", "empty-tomb", "the-passover"],
          caption: "Key moments retold across several films.",
        },
      ],
    })
    const { experience: exp } = await generateExperience("easter", results)
    expect(exp.sections).toHaveLength(2)
    expect(exp.sections[0].type).toBe("spotlight")
  })

  it("drops hallucinated slugs from theme-carousel sections", async () => {
    mockOpenRouterJsonContent({
      title: "Test",
      intro: "Test",
      sections: [
        {
          type: "theme-carousel",
          theme: "Resurrection",
          videoSlugs: ["easter", "definitely-not-a-real-slug", "empty-tomb"],
          caption: "c",
        },
        {
          type: "bible-verse",
          reference: "John 3:16",
          text: "For God so loved the world...",
          reflection: "The core gospel.",
        },
      ],
    })
    const { experience: exp } = await generateExperience("easter", results)
    const carousel = exp.sections.find((s) => s.type === "theme-carousel")
    if (!carousel || carousel.type !== "theme-carousel") {
      throw new Error("expected carousel section to survive")
    }
    expect(carousel.videoSlugs).toEqual(["easter", "empty-tomb"])
  })

  it("drops spotlight sections whose slug isn't in the catalog", async () => {
    mockOpenRouterJsonContent({
      title: "Test",
      intro: "Test",
      sections: [
        { type: "spotlight", videoSlug: "ghost-slug", why: "nope" },
        {
          type: "theme-carousel",
          theme: "Easter",
          videoSlugs: ["easter", "empty-tomb"],
          caption: "c",
        },
      ],
    })
    const { experience: exp } = await generateExperience("easter", results)
    expect(exp.sections.every((s) => s.type !== "spotlight")).toBe(true)
  })

  it("throws NO_VALID_SECTIONS when every section is unusable", async () => {
    mockOpenRouterJsonContent({
      title: "Test",
      intro: "Test",
      sections: [
        { type: "spotlight", videoSlug: "ghost-1", why: "no" },
        {
          type: "theme-carousel",
          theme: "x",
          videoSlugs: ["ghost-2", "ghost-3", "ghost-4"],
          caption: "c",
        },
      ],
    })
    await expect(generateExperience("easter", results)).rejects.toMatchObject({
      code: "NO_VALID_SECTIONS",
    })
  })

  it("throws SCHEMA_MISMATCH when the model returns a wrong-shape payload", async () => {
    mockOpenRouterJsonContent({ title: "Test" }) // missing intro + sections
    await expect(generateExperience("easter", results)).rejects.toMatchObject({
      code: "SCHEMA_MISMATCH",
    })
  })

  it("throws SCHEMA_MISMATCH when the model content is not JSON", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "not actually json" } }],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch
    await expect(generateExperience("easter", results)).rejects.toMatchObject({
      code: "SCHEMA_MISMATCH",
    })
  })

  it("throws UPSTREAM_ERROR on non-2xx OpenRouter response", async () => {
    global.fetch = vi.fn(
      async () => new Response("", { status: 429 }),
    ) as unknown as typeof fetch
    await expect(generateExperience("easter", results)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    })
  })

  it("retries once on 5xx then throws UPSTREAM_ERROR if still failing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
    global.fetch = fetchMock as unknown as typeof fetch
    await expect(generateExperience("easter", results)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("preserves the ExperienceGeneratorError class at the boundary", async () => {
    delete process.env.OPENROUTER_API_KEY
    try {
      await generateExperience("easter", results)
      throw new Error("should not reach")
    } catch (err) {
      expect(err).toBeInstanceOf(ExperienceGeneratorError)
    }
  })
})
