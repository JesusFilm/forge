import { describe, expect, it } from "vitest"

import type { DraftExperience } from "@forge/experience-schema"

import {
  _internals,
  launchMastraExperienceVariant,
  type MastraExperienceVariantLaunchInput,
} from "./mastra-experience-variant-client"

const VALID_DRAFT: DraftExperience = {
  title: "Easter, for a grieving heart",
  metaDescription: "Comfort and quiet hope in the Easter story.",
  blocks: [
    { t: "text", contentParagraphs: ["Grief is heavy. The story meets it."] },
    { t: "text", contentParagraphs: ["Hope, offered gently."] },
  ],
}

const INPUT: MastraExperienceVariantLaunchInput = {
  topic: "Easter",
  locale: "en",
  personaId: "grieving",
  candidates: [],
}

function jsonResponse(status: number, obj: unknown): Response {
  return {
    status,
    text: async () => JSON.stringify(obj),
  } as unknown as Response
}

const CALLER = { baseUrl: "http://mastra.test", bearer: "k" } as const

describe("launchMastraExperienceVariant", () => {
  it("returns the validated draft + personaId on a 200 envelope", async () => {
    const result = await launchMastraExperienceVariant(INPUT, {
      ...CALLER,
      fetchImpl: async () =>
        jsonResponse(200, {
          ok: true,
          personaId: "grieving",
          draft: VALID_DRAFT,
        }),
    })
    expect(result).toMatchObject({
      ok: true,
      personaId: "grieving",
      draft: { title: VALID_DRAFT.title },
    })
  })

  it("short-circuits to config_missing when baseUrl/bearer are unset (no throw)", async () => {
    const result = await launchMastraExperienceVariant(INPUT, {
      baseUrl: "",
      bearer: "",
    })
    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("maps a 401 to auth_failed", async () => {
    const result = await launchMastraExperienceVariant(INPUT, {
      ...CALLER,
      fetchImpl: async () => jsonResponse(401, { error: "nope" }),
    })
    expect(result).toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
    })
  })

  it("passes a route failure envelope through verbatim", async () => {
    const result = await launchMastraExperienceVariant(INPUT, {
      ...CALLER,
      fetchImpl: async () =>
        jsonResponse(502, {
          ok: false,
          reason: "generation_failed",
          retryable: true,
        }),
    })
    expect(result).toEqual({
      ok: false,
      reason: "generation_failed",
      retryable: true,
    })
  })

  it("treats a 2xx body with an invalid draft as parse_error", async () => {
    const result = await launchMastraExperienceVariant(INPUT, {
      ...CALLER,
      fetchImpl: async () =>
        jsonResponse(200, { ok: true, personaId: "x", draft: { blocks: [] } }),
    })
    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })

  it("maps a non-2xx without a valid envelope to a retryable network_error", async () => {
    const result = await launchMastraExperienceVariant(INPUT, {
      ...CALLER,
      fetchImpl: async () => jsonResponse(500, {}),
    })
    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })

  it("coerces env-derived timeouts and guards bad values (t3-env skipValidation trap)", () => {
    expect(_internals.resolveTimeoutMs("200000")).toBe(200_000)
    expect(_internals.resolveTimeoutMs(120_000)).toBe(120_000)
    // undefined / 0 / negative / NaN all fall back to the default
    expect(_internals.resolveTimeoutMs(undefined)).toBe(200_000)
    expect(_internals.resolveTimeoutMs(0)).toBe(200_000)
    expect(_internals.resolveTimeoutMs(-5)).toBe(200_000)
    expect(_internals.resolveTimeoutMs("not-a-number")).toBe(200_000)
  })

  it("classifies a client-side abort as timeout (retryable), not network_error", async () => {
    const result = await launchMastraExperienceVariant(INPUT, {
      ...CALLER,
      fetchImpl: async () => {
        throw Object.assign(new Error("The operation timed out."), {
          name: "TimeoutError",
        })
      },
    })
    expect(result).toEqual({ ok: false, reason: "timeout", retryable: true })
  })

  it("round-trips a valid draft over the real node:http transport", async () => {
    const { createServer } = await import("node:http")
    let sawAuth: string | undefined
    const server = createServer((req, res) => {
      sawAuth = req.headers.authorization
      const chunks: Buffer[] = []
      req.on("data", (c: Buffer) => chunks.push(c))
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(
          JSON.stringify({
            ok: true,
            personaId: "grieving",
            draft: VALID_DRAFT,
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    if (address == null || typeof address === "string") {
      throw new Error("expected a TCP address")
    }

    try {
      const result = await launchMastraExperienceVariant(INPUT, {
        baseUrl: `http://127.0.0.1:${address.port}`,
        bearer: "svc-key",
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("unreachable")
      expect(result.personaId).toBe("grieving")
      expect(sawAuth).toBe("Bearer svc-key")
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("maps an over-cap 200 body to parse_error instead of buffering it", async () => {
    // > 2MB body; the cap discards it and the empty-body ladder classifies
    // the 2xx as parse_error (retryable) — the graceful-failure path.
    const huge = `{"ok":true,"personaId":"grieving","draft":{"pad":"${"あ".repeat(1_100_000)}"}}`
    const result = await launchMastraExperienceVariant(INPUT, {
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
})
