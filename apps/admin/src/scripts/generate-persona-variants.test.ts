import { describe, expect, it } from "vitest"

import type { DraftExperience, VideoCandidate } from "@forge/experience-schema"

import type { NormalizedExperienceDraft } from "@/services/experience-ai/experience-ai-normalize"
import {
  assertNotProdUrl,
  personaVariantReviewUrl,
  runPersonaVariants,
  variantSlug,
  type RunPersonaVariantsDeps,
} from "./generate-persona-variants"

const DRAFT: DraftExperience = {
  title: "T",
  metaDescription: "M",
  blocks: [
    { t: "text", contentParagraphs: ["a"] },
    { t: "text", contentParagraphs: ["b"] },
  ],
}

const NORMALIZED: NormalizedExperienceDraft = {
  title: "T",
  metaDescription: "M",
  blocks: [{ t: "text", contentParagraphs: ["a"] }],
}

const CANDIDATES: readonly VideoCandidate[] = []

function deps(over: Partial<RunPersonaVariantsDeps> = {}): {
  deps: RunPersonaVariantsDeps
  persistedPersonas: string[]
} {
  const persistedPersonas: string[] = []
  return {
    persistedPersonas,
    deps: {
      candidates: CANDIDATES,
      launchVariant: async ({ personaId }) => ({
        ok: true,
        draft: DRAFT,
        personaId,
      }),
      normalize: () => NORMALIZED,
      persist: async ({ slug }) => {
        const personaId = slug.split("-").slice(-1)[0]!
        persistedPersonas.push(personaId)
        return {
          experienceId: `exp-${personaId}`,
          localeId: `loc-${personaId}`,
        }
      },
      ...over,
    },
  }
}

describe("generate-persona-variants", () => {
  it("produces one outcome per persona and persists each success", async () => {
    const { deps: d, persistedPersonas } = deps()
    const { outcomes } = await runPersonaVariants(
      {
        topic: "Easter",
        locale: "en",
        personaIds: ["grieving", "family"],
        concurrency: 2,
      },
      d,
    )
    expect(outcomes).toHaveLength(2)
    expect(outcomes.every((o) => o.status === "succeeded")).toBe(true)
    expect(persistedPersonas.sort()).toEqual(["family", "grieving"])
  })

  it("isolates a per-persona generation failure (others still persist)", async () => {
    const { deps: d, persistedPersonas } = deps({
      launchVariant: async ({ personaId }) =>
        personaId === "family"
          ? { ok: false, reason: "timeout", retryable: true }
          : { ok: true, draft: DRAFT, personaId },
    })
    const { outcomes } = await runPersonaVariants(
      {
        topic: "Easter",
        locale: "en",
        personaIds: ["grieving", "family"],
        concurrency: 2,
      },
      d,
    )
    const byPersona = Object.fromEntries(outcomes.map((o) => [o.personaId, o]))
    expect(byPersona.grieving?.status).toBe("succeeded")
    expect(byPersona.family).toMatchObject({
      status: "failed",
      reason: "timeout",
    })
    expect(persistedPersonas).toEqual(["grieving"])
  })

  it("rejects a variant whose blocks fail the normalize gate and does not persist it (R11/AE4)", async () => {
    const { deps: d, persistedPersonas } = deps({
      normalize: (draft) => {
        if (draft === DRAFT) throw new Error("INVALID_BLOCKS")
        return NORMALIZED
      },
    })
    const { outcomes } = await runPersonaVariants(
      {
        topic: "Easter",
        locale: "en",
        personaIds: ["grieving"],
        concurrency: 1,
      },
      d,
    )
    expect(outcomes[0]).toMatchObject({ status: "failed" })
    expect(persistedPersonas).toEqual([])
  })

  it("never exceeds the concurrency cap", async () => {
    const { deps: d } = deps({
      launchVariant: async ({ personaId }) => {
        await new Promise((r) => setTimeout(r, 10))
        return { ok: true, draft: DRAFT, personaId }
      },
    })
    const { observedMaxInFlight } = await runPersonaVariants(
      {
        topic: "Easter",
        locale: "en",
        personaIds: ["a", "b", "c", "d", "e"],
        concurrency: 2,
      },
      d,
    )
    expect(observedMaxInFlight).toBeLessThanOrEqual(2)
    expect(observedMaxInFlight).toBe(2)
  })

  it("guards against production-like DATABASE_URL hosts", () => {
    expect(() =>
      assertNotProdUrl("postgresql://forge:forge@db:5432/forge_admin"),
    ).not.toThrow()
    expect(() =>
      assertNotProdUrl("postgresql://u:p@admin.jesusfilm.org:5432/db"),
    ).toThrow()
    expect(() =>
      assertNotProdUrl("postgresql://u:p@something.railway.app:5432/db"),
    ).toThrow()
    expect(() => assertNotProdUrl(undefined)).toThrow()
  })

  it("builds a topic+persona slug", () => {
    expect(variantSlug("Easter", "grieving")).toBe("easter-grieving")
    expect(variantSlug("Who Is Jesus?", "seeker-skeptic")).toBe(
      "who-is-jesus-seeker-skeptic",
    )
  })

  it("builds canonical operator review URLs from the Experience locale", () => {
    expect(personaVariantReviewUrl("easter-grieving", "en")).toBe(
      "http://localhost:3000/watch/easter-grieving.html",
    )
    expect(personaVariantReviewUrl("easter-grieving", "es")).toBe(
      "http://localhost:3000/watch/easter-grieving.html/spanish-castilian.html",
    )
    expect(personaVariantReviewUrl("russian", "en")).toBe(
      "http://localhost:3000/watch/russian.html/english.html",
    )
    expect(personaVariantReviewUrl("easter-grieving", "xx")).toBeNull()
  })
})
