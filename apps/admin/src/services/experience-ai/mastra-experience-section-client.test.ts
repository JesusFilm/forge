import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: {
    MASTRA_BASE_URL: undefined as string | undefined,
    MASTRA_SERVICE_API_KEY: undefined as string | undefined,
    MASTRA_SECTION_TIMEOUT_MS: 75_000 as number,
  },
}))

vi.mock("@/config/env", () => mockEnv)

import {
  launchMastraExperienceSection,
  _internals,
} from "./mastra-experience-section-client"

const VALID_SECTION = {
  blocks: [
    {
      t: "text" as const,
      heading: "Why this scene matters",
      contentParagraphs: ["It anchors the whole story."],
    },
  ],
}

const INPUT = {
  locale: "en",
  anchorCandidate: {
    videoId: "video-1",
    title: "Hope Story",
    description: null,
    slug: "hope",
  },
  grounding: {
    studyQuestions: [],
    citations: [],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

function jsonResponse(status: number, obj: unknown): Response {
  return {
    status,
    text: async () => JSON.stringify(obj),
  } as unknown as Response
}

const CALLER = { baseUrl: "http://mastra.test", bearer: "k" } as const

describe("launchMastraExperienceSection", () => {
  beforeEach(() => {
    mockEnv.env.MASTRA_BASE_URL = undefined
    mockEnv.env.MASTRA_SERVICE_API_KEY = undefined
    mockEnv.env.MASTRA_SECTION_TIMEOUT_MS = 75_000
  })

  it("short-circuits to config_missing when caller vars are unset", async () => {
    const fetchImpl = vi.fn()
    const result = await launchMastraExperienceSection(INPUT, { fetchImpl })
    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("returns the validated section draft on a 200 envelope", async () => {
    const result = await launchMastraExperienceSection(INPUT, {
      ...CALLER,
      fetchImpl: async () =>
        jsonResponse(200, { ok: true, draft: VALID_SECTION }),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")
    expect(result.draft.blocks[0]).toMatchObject({ t: "text" })
  })

  it("maps a 401 to auth_failed", async () => {
    const result = await launchMastraExperienceSection(INPUT, {
      ...CALLER,
      fetchImpl: async () => jsonResponse(401, {}),
    })
    expect(result).toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
    })
  })

  it("passes a route failure envelope through verbatim", async () => {
    const result = await launchMastraExperienceSection(INPUT, {
      ...CALLER,
      fetchImpl: async () =>
        jsonResponse(504, { ok: false, reason: "timeout", retryable: true }),
    })
    expect(result).toEqual({ ok: false, reason: "timeout", retryable: true })
  })

  it("treats a 2xx body with an invalid draft as parse_error", async () => {
    const result = await launchMastraExperienceSection(INPUT, {
      ...CALLER,
      fetchImpl: async () => jsonResponse(200, { ok: true, draft: {} }),
    })
    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })

  it("keeps a client-side abort as network_error (deliberate asymmetry)", async () => {
    // Unlike the draft/variant clients, the section budget (75s) exceeds
    // mastra's internal section budget (60s), so a client-side abort here is
    // a genuine transport anomaly — the network_error fold is intentional.
    const result = await launchMastraExperienceSection(INPUT, {
      ...CALLER,
      fetchImpl: async () => {
        throw Object.assign(new Error("The operation timed out."), {
          name: "TimeoutError",
        })
      },
    })
    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })

  it("maps an over-cap 200 body to parse_error instead of buffering it", async () => {
    const huge = `{"ok":true,"draft":{"pad":"${"あ".repeat(1_100_000)}"}}`
    const result = await launchMastraExperienceSection(INPUT, {
      ...CALLER,
      fetchImpl: async () =>
        ({ status: 200, text: async () => huge }) as unknown as Response,
    })
    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })

  it("coerces env-derived timeouts and guards bad values (t3-env skipValidation trap)", () => {
    expect(_internals.resolveTimeoutMs("75000")).toBe(75_000)
    expect(_internals.resolveTimeoutMs(60_000)).toBe(60_000)
    expect(_internals.resolveTimeoutMs(undefined)).toBe(75_000)
    expect(_internals.resolveTimeoutMs(0)).toBe(75_000)
    expect(_internals.resolveTimeoutMs(-5)).toBe(75_000)
    expect(_internals.resolveTimeoutMs("not-a-number")).toBe(75_000)
  })
})
