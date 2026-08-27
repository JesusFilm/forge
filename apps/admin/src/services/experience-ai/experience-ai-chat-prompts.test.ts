import { describe, expect, it } from "vitest"

import { buildChatPrompt } from "./experience-ai-chat-prompts"

const candidate = {
  ref: "v01" as const,
  videoId: "video-cuid-1",
  slug: "hope-story",
  title: "Hope Story",
  description: "A story about hope.",
  previewImageUrl: null,
  previewStreamUrl: null,
  label: null,
}

describe("buildChatPrompt", () => {
  it("keeps empty-canvas full creation out of the Codex prompt path", () => {
    const prompt = buildChatPrompt({
      state: {
        locale: "en",
        isHomepage: false,
        title: "",
        metaDescription: null,
        ogImageUrl: null,
        blocksPreview: [],
      },
      history: [],
      candidates: [candidate],
      userPrompt: "Create an experience about forgiveness",
    })

    // Brief flow is disabled — prompt instructs the model to produce a
    // FULL inline draft on empty canvas instead of deferring elsewhere.
    expect(prompt).not.toContain("guided editorial brief workflow")
    expect(prompt).toContain('complete "blocks" array')
    expect(prompt).toContain("do NOT defer to a brief flow")
  })

  it("exposes candidate videoId values for generated block references", () => {
    const prompt = buildChatPrompt({
      state: {
        locale: "en",
        isHomepage: false,
        title: "Existing",
        metaDescription: "Existing description",
        ogImageUrl: null,
        blocksPreview: [{ t: "text", contentParagraphs: ["Existing"] }],
      },
      history: [],
      candidates: [candidate],
      userPrompt: "Add a video hero",
    })

    expect(prompt).toContain('"videoId": "video-cuid-1"')
    expect(prompt).toContain("use videoId values as block videoId fields")
  })

  it("tells add-section prompts to preserve existing blocks and insert one new block", () => {
    const prompt = buildChatPrompt({
      state: {
        locale: "en",
        isHomepage: false,
        title: "Existing",
        metaDescription: "Existing description",
        ogImageUrl: null,
        blocksPreview: [
          { t: "videoHero", heading: "Existing hero" },
          { t: "cta", heading: "Existing next step", buttonLabel: "Go" },
        ],
      },
      history: [],
      candidates: [candidate],
      userPrompt: "Add a reflection section related to the main theme",
    })

    expect(prompt).toContain("preserve every existing top-level block")
    expect(prompt).toContain(
      'Return "mutations.blocks" as the complete existing blocks array plus exactly the requested new top-level block',
    )
    expect(prompt).toContain("Do not rename, reorder, replace, or rewrite")
  })

  it("does not teach rejected mediaCollection item label fields", () => {
    const prompt = buildChatPrompt({
      state: {
        locale: "en",
        isHomepage: false,
        title: "Existing",
        metaDescription: "Existing description",
        ogImageUrl: null,
        blocksPreview: [{ t: "text", contentParagraphs: ["Existing"] }],
      },
      history: [],
      candidates: [candidate],
      userPrompt: "Generate content about forgiveness",
    })

    expect(prompt).toContain('"titleOverride":"Optional item title"')
    expect(prompt).toContain('"labelOverride":"Optional eyebrow label"')
    expect(prompt).toContain('DO NOT use "label" on mediaCollection items')
    expect(prompt).toContain('"thumbnailOrientation":"horizontal"')
    expect(prompt).toContain(
      '"thumbnailOrientation" OPTIONAL: "horizontal" | "vertical"',
    )
    expect(prompt).not.toContain('"items":[{"videoId":"<cuid>","label":"..."}]')
  })

  it("keeps prompt examples aligned with strict block schemas", () => {
    const prompt = buildChatPrompt({
      state: {
        locale: "en",
        isHomepage: false,
        title: "Existing",
        metaDescription: "Existing description",
        ogImageUrl: null,
        blocksPreview: [{ t: "text", contentParagraphs: ["Existing"] }],
      },
      history: [],
      candidates: [candidate],
      userPrompt: "Add reflection sections and next steps",
    })

    expect(prompt).toContain(
      'Use candidate "videoId" values in block "videoId" fields',
    )
    expect(prompt).toContain(
      'Inside section.content: "mediaCollection" | "text" | "promoBanner"',
    )
    expect(prompt).toContain('"t":"navigationCarousel"')
    expect(prompt).toContain('"contentId":"s02"')
    expect(prompt).toContain('"t":"quizButton"')
    expect(prompt).toContain('"buttonText":"Take the quiz"')
    expect(prompt).toContain('"iframeSrc":"https://demo.nextstep.is/quiz"')
    expect(prompt).toContain('"t":"relatedQuestions"')
    expect(prompt).toContain('"questions":[{"question"')
    expect(prompt).toContain('Use "heading", NOT "title"')
    expect(prompt).not.toContain('"items":[{"label":"Forgiveness","href"')
    expect(prompt).not.toContain('"t":"quizButton","label"')
    expect(prompt).not.toContain("use their refs verbatim")
    expect(prompt).not.toContain('candidate\'s "id" field')
  })

  it("documents the homepage category rail contract from effective locale state", () => {
    const prompt = buildChatPrompt({
      state: {
        locale: "en",
        isHomepage: true,
        title: "Watch",
        metaDescription: null,
        ogImageUrl: null,
        blocksPreview: [
          {
            t: "watchHomeCategoryRail",
            categoryIds: ["family", "gospels", "jesus"],
          },
        ],
      },
      history: [],
      candidates: [],
      userPrompt: "Tighten the page title",
    })

    expect(prompt).toContain('"isHomepage": true')
    expect(prompt).toContain('"t":"watchHomeCategoryRail"')
    expect(prompt).toContain(
      '"jesus", "gospels", "short-videos", "family", "relationships", "women", "students", "sports", "good-news", "hope", "training", "easter", "christmas"',
    )
    expect(prompt).toContain("top-level only")
    expect(prompt).toContain("homepage-only")
    expect(prompt).toContain("at most once")
    expect(prompt).toContain("non-empty, duplicate-free")
    expect(prompt).toContain("categoryIds order is the rendered tile order")
    expect(prompt).toContain(
      "preserve that block and its categoryIds order during unrelated edits",
    )
  })

  it("forbids proposing the category rail when effective homepage state is false", () => {
    const prompt = buildChatPrompt({
      state: {
        locale: "en",
        isHomepage: false,
        title: "Hope",
        metaDescription: null,
        ogImageUrl: null,
        blocksPreview: [{ t: "text", contentParagraphs: ["Hope"] }],
      },
      history: [],
      candidates: [],
      userPrompt: "Add the Watch category rail",
    })

    expect(prompt).toContain('"isHomepage": false')
    expect(prompt).toContain(
      "Do not propose this block when effective isHomepage is false",
    )
  })
})
