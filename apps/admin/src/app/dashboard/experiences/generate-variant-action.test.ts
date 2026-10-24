import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "@prisma/client"
import type { DraftExperience } from "@forge/experience-schema"

import type { Principal } from "@/auth/principal"

import { runGenerateVariantAction } from "./generate-variant-action"

// A source experience locale the editor is duplicating from.
const SOURCE = {
  id: "loc-src",
  slug: "easter",
  title: "Easter",
  metaDescription: "An Easter page for everyone.",
  blocks: [
    {
      t: "text",
      heading: "He is risen",
      contentParagraphs: ["The tomb is empty."],
    },
    { t: "cta", buttonLabel: "Watch" },
  ],
  status: "PUBLISHED",
  experienceId: "exp-src",
  experience: { ownerId: "u1", archivedAt: null },
}

function makeDeps(sourceRow: unknown = SOURCE, user?: Principal) {
  const prisma = {
    experienceLocale: { findUnique: vi.fn(async () => sourceRow) },
  } as unknown as PrismaClient
  return { prisma, user: user ?? ({ id: "u1", role: "ADMIN" } as Principal) }
}

// A valid generated draft (2 text blocks — normalizes with no candidates).
const VALID_DRAFT: DraftExperience = {
  title: "Easter, for a grieving heart",
  metaDescription: "Comfort and quiet hope in the Easter story.",
  blocks: [
    {
      t: "text",
      heading: "You are not alone",
      contentParagraphs: ["Grief is heavy. The Easter story meets it gently."],
    },
    {
      t: "text",
      heading: "Hope is real",
      contentParagraphs: ["The resurrection is a quiet, deep word of hope."],
    },
  ],
}

const INPUT = {
  sourceLocaleId: "loc-src",
  locale: "en",
  personaId: "grieving",
}

const okLaunch = vi.fn(async () => ({
  ok: true as const,
  draft: VALID_DRAFT,
  personaId: "grieving",
}))

function baseOverrides() {
  return {
    loadCandidates: vi.fn(async () => []),
    launchVariant: vi.fn(async () => ({
      ok: true as const,
      draft: VALID_DRAFT,
      personaId: "grieving",
    })),
    persist: vi.fn(async () => ({
      experienceId: "exp-new",
      localeId: "loc-new",
    })),
  }
}

describe("runGenerateVariantAction", () => {
  it("creates a DRAFT duplicate and returns its editor href (happy path)", async () => {
    const persist = vi.fn(async () => ({
      experienceId: "exp-new",
      localeId: "loc-new",
    }))
    const result = await runGenerateVariantAction(makeDeps(), INPUT, {
      loadCandidates: vi.fn(async () => []),
      launchVariant: okLaunch,
      persist,
    })
    expect(result).toMatchObject({
      ok: true,
      experienceId: "exp-new",
      localeId: "loc-new",
      slug: "easter-grieving",
    })
    if (result.ok)
      expect(result.href).toContain("/dashboard/experiences/exp-new")
    // The normalized title + derived slug reach persistence.
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "easter-grieving",
        title: "Easter, for a grieving heart",
        locale: "en",
      }),
    )
  })

  it("seeds topic + a sanitized exemplar from the source experience", async () => {
    const launchVariant = vi.fn(
      async (input: {
        topic: string
        personaId: string
        exemplar?: string
      }) => {
        void input
        return { ok: true as const, draft: VALID_DRAFT, personaId: "grieving" }
      },
    )
    await runGenerateVariantAction(makeDeps(), INPUT, {
      loadCandidates: vi.fn(async () => []),
      launchVariant,
      persist: vi.fn(async () => ({ experienceId: "e", localeId: "l" })),
    })
    const call = launchVariant.mock.calls[0]![0]
    expect(call.topic).toBe("Easter")
    expect(call.personaId).toBe("grieving")
    // Exemplar is the sanitized source outline — a non-empty string built from
    // the source page (structure/voice reference; video ids stripped upstream).
    expect(typeof call.exemplar).toBe("string")
    expect((call.exemplar as string).length).toBeGreaterThan(0)
  })

  it("returns SOURCE_NOT_FOUND when the source locale is missing", async () => {
    const result = await runGenerateVariantAction(
      makeDeps(null),
      INPUT,
      baseOverrides(),
    )
    expect(result).toMatchObject({ ok: false, code: "SOURCE_NOT_FOUND" })
  })

  it("returns FORBIDDEN when the user cannot edit the source", async () => {
    const result = await runGenerateVariantAction(
      makeDeps(SOURCE, { id: "other", role: "VIEWER" } as Principal),
      INPUT,
      baseOverrides(),
    )
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" })
  })

  it("maps remote config_missing → NOT_CONFIGURED", async () => {
    const result = await runGenerateVariantAction(makeDeps(), INPUT, {
      loadCandidates: vi.fn(async () => []),
      launchVariant: vi.fn(async () => ({
        ok: false as const,
        reason: "config_missing" as const,
        retryable: false,
      })),
    })
    expect(result).toMatchObject({ ok: false, code: "NOT_CONFIGURED" })
  })

  it("maps remote generation_failed → GENERATION_FAILED", async () => {
    const result = await runGenerateVariantAction(makeDeps(), INPUT, {
      loadCandidates: vi.fn(async () => []),
      launchVariant: vi.fn(async () => ({
        ok: false as const,
        reason: "generation_failed" as const,
        retryable: true,
      })),
    })
    expect(result).toMatchObject({ ok: false, code: "GENERATION_FAILED" })
  })

  it("maps a below-minimum draft → SCHEMA_MISMATCH (real normalize gate)", async () => {
    const thin: DraftExperience = {
      title: "x",
      metaDescription: "y",
      blocks: [{ t: "text", heading: "h", contentParagraphs: ["p"] }],
    }
    const result = await runGenerateVariantAction(makeDeps(), INPUT, {
      loadCandidates: vi.fn(async () => []),
      launchVariant: vi.fn(async () => ({
        ok: true as const,
        draft: thin,
        personaId: "grieving",
      })),
      persist: vi.fn(async () => ({ experienceId: "e", localeId: "l" })),
    })
    expect(result).toMatchObject({ ok: false, code: "SCHEMA_MISMATCH" })
  })
})
