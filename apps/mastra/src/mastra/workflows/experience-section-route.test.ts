import { describe, expect, it } from "vitest"

import {
  DraftVideoSectionSchema,
  type DraftVideoSection,
} from "@forge/experience-schema"

import {
  handleExperienceSectionRouteRequest,
  type SectionAgentMastra,
} from "./experience-section-route"

const SERVICE_KEYS = ["test-service-key"] as const
const AUTH = "Bearer test-service-key"

const VALID_SECTION: DraftVideoSection = {
  blocks: [
    { t: "videoHero", candidateRef: "v01", heading: "The Resurrection" },
    {
      t: "relatedQuestions",
      questions: [{ question: "Why does it matter?", answer: "Because..." }],
    },
    {
      t: "bibleQuotesCarousel",
      quotes: [
        {
          reference: "John 20:19-29",
          osisId: "John.20.19",
          chapterStart: 20,
          verseStart: 19,
          verseEnd: 29,
        },
      ],
    },
  ],
}

const REQUEST_BODY = {
  locale: "en",
  anchorCandidate: { videoId: "vid1", title: "The Resurrection" },
  grounding: {
    studyQuestions: [{ text: "Why does it matter?", order: 1 }],
    citations: [
      {
        reference: "John 20:19-29",
        osisId: "John.20.19",
        chapterStart: 20,
        verseStart: 19,
        verseEnd: 29,
      },
    ],
  },
}

type GenerateOpts = {
  maxOutputTokens?: number
  abortSignal?: AbortSignal
  toolChoice?: string
  structuredOutput?: unknown
}

function makeMastra(
  generate: (
    prompt: string,
    opts: GenerateOpts,
  ) => Promise<{ text: string; object?: unknown }>,
) {
  const calls: Array<{ prompt: string; opts: GenerateOpts }> = []
  const agentIds: string[] = []
  const mastra: SectionAgentMastra = {
    getAgentById: (id: string) => {
      agentIds.push(id)
      return {
        generate: (prompt: string, opts: GenerateOpts) => {
          calls.push({ prompt, opts })
          return generate(prompt, opts)
        },
      }
    },
  }
  return { mastra, calls, agentIds }
}

const readJson = (body: unknown) => () => Promise.resolve(body)

describe("handleExperienceSectionRouteRequest", () => {
  it("401s without a valid service bearer", async () => {
    const { mastra } = makeMastra(async () => ({
      text: "",
      object: VALID_SECTION,
    }))
    const out = await handleExperienceSectionRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: SERVICE_KEYS,
      readJson: readJson(REQUEST_BODY),
      getMastra: () => mastra,
    })
    expect(out.status).toBe(401)
  })

  it("400s on an invalid request body", async () => {
    const { mastra } = makeMastra(async () => ({
      text: "",
      object: VALID_SECTION,
    }))
    const out = await handleExperienceSectionRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: readJson({ locale: "en" }), // missing anchorCandidate + grounding
      getMastra: () => mastra,
    })
    expect(out.status).toBe(400)
    expect(out.body).toMatchObject({ ok: false, reason: "invalid_input" })
  })

  it("returns the section from a structured (object) result and resolves the agent by id", async () => {
    const { mastra, agentIds } = makeMastra(async () => ({
      text: "",
      object: VALID_SECTION,
    }))
    const out = await handleExperienceSectionRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: readJson(REQUEST_BODY),
      getMastra: () => mastra,
      structuredOutputEnabled: true,
    })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ ok: true })
    expect(agentIds).toEqual(["generate-video-section"])
    const body = out.body as { ok: true; draft: DraftVideoSection }
    expect(DraftVideoSectionSchema.safeParse(body.draft).success).toBe(true)
  })

  it("falls back to parsing the text envelope when no structured object is present", async () => {
    const { mastra, calls } = makeMastra(async () => ({
      text:
        "Here is the section:\n```json\n" +
        JSON.stringify(VALID_SECTION) +
        "\n```",
    }))
    const out = await handleExperienceSectionRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: readJson(REQUEST_BODY),
      getMastra: () => mastra,
      structuredOutputEnabled: false,
    })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ ok: true })
    // structuredOutput is NOT requested off the gateway path.
    expect(calls[0].opts.structuredOutput).toBeUndefined()
    expect(calls[0].opts.toolChoice).toBeUndefined()
  })

  it("passes structuredOutput + toolChoice:none when gateway structured output is enabled", async () => {
    const { mastra, calls } = makeMastra(async () => ({
      text: "",
      object: VALID_SECTION,
    }))
    await handleExperienceSectionRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: readJson(REQUEST_BODY),
      getMastra: () => mastra,
      structuredOutputEnabled: true,
    })
    expect(calls[0].opts.toolChoice).toBe("none")
    expect(calls[0].opts.structuredOutput).toBeDefined()
  })

  it("returns generation_failed (not retryable) when the result is not a valid section", async () => {
    const { mastra } = makeMastra(async () => ({ text: "not json at all" }))
    const out = await handleExperienceSectionRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: readJson(REQUEST_BODY),
      getMastra: () => mastra,
      structuredOutputEnabled: false,
    })
    expect(out.status).toBe(502)
    expect(out.body).toMatchObject({
      ok: false,
      reason: "generation_failed",
      retryable: false,
    })
  })

  it("classifies an internal-budget timeout as retryable timeout", async () => {
    const { mastra } = makeMastra(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ text: "late" }), 200),
        ),
    )
    const out = await handleExperienceSectionRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: readJson(REQUEST_BODY),
      getMastra: () => mastra,
      budgetMs: 15,
      structuredOutputEnabled: false,
    })
    expect(out.status).toBe(504)
    expect(out.body).toMatchObject({
      ok: false,
      reason: "timeout",
      retryable: true,
    })
  })
})
