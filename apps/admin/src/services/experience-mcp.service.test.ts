import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Principal } from "@/auth/principal"
import type { DraftExperience } from "@forge/experience-schema"
import { ExperienceMcpService } from "./experience-mcp.service"

vi.mock("@/services/revalidate-webhook", () => ({
  emitRevalidateWebhook: vi.fn(),
}))
vi.mock("@/services/watch-route-manifest-refresh.service", () => ({
  refreshWatchRouteManifest: vi.fn().mockResolvedValue({ ok: true }),
}))

function mockPrisma() {
  const contentRevisionCreate = vi.fn()
  const experienceLocaleUpdate = vi.fn()
  const experienceCreate = vi.fn()
  return {
    experience: {
      create: experienceCreate,
    },
    experienceLocale: {
      findFirst: vi.fn(),
    },
    contentRevisionCreate,
    experienceLocaleUpdate,
    $transaction: vi.fn(
      (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
        callback({
          contentRevision: { create: contentRevisionCreate },
          experienceLocale: { update: experienceLocaleUpdate },
          // The atomic generate persist runs ExperienceService.create through
          // the transaction client — same handle as the top-level mock.
          experience: { create: experienceCreate },
        }),
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const EDITOR_ALICE: Principal = { id: "alice", role: "EDITOR" }
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const PUBLIC_USER: Principal | null = null

const updatedAt = new Date("2026-07-27T12:00:00.000Z")

const CREATED_LOCALE = {
  id: "loc-en",
  experienceId: "exp-1",
  locale: "en",
  slug: "hope",
  isHomepage: false,
  pathSegment: null,
  title: "Hope",
  metaDescription: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  blocks: [{ t: "text", heading: "Hope" }],
  status: "DRAFT",
  publishedAt: null,
  updatedAt,
}

const CREATED_EXPERIENCE = {
  id: "exp-1",
  isTemplate: false,
  ownerId: "admin-1",
  locales: [CREATED_LOCALE],
}

const VALID_INPUT = {
  locale: "en",
  slug: "hope",
  title: "Hope",
  blocks: [{ t: "text", heading: "Hope" }],
}

describe("ExperienceMcpService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: ExperienceMcpService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new ExperienceMcpService(prisma)
  })

  it("creates a DRAFT Experience through the existing Experience service", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockResolvedValueOnce(CREATED_EXPERIENCE)

    await expect(
      service.createExperience({ input: VALID_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      ok: true,
      experience: { id: "exp-1", isTemplate: false, ownerId: "admin-1" },
      locale: {
        id: "loc-en",
        experienceId: "exp-1",
        locale: "en",
        slug: "hope",
        status: "DRAFT",
        publishedAt: null,
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
      editorUrl: "http://localhost:3003/dashboard/experiences/exp-1?locale=en",
    })

    expect(prisma.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "admin-1",
          locales: expect.objectContaining({
            create: expect.objectContaining({
              locale: "en",
              slug: "hope",
              title: "Hope",
            }),
          }),
        }),
        include: { locales: true },
      }),
    )
  })

  it("EDITOR becomes the owner of the created Experience", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockResolvedValueOnce({
      ...CREATED_EXPERIENCE,
      ownerId: "alice",
    })

    await service.createExperience({ input: VALID_INPUT, user: EDITOR_ALICE })

    expect(prisma.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: "alice" }),
      }),
    )
  })

  it("VIEWER cannot create — rejected before the slug probe runs", async () => {
    // The conflict envelope names other owners' draft ids, so the permission
    // gate must fire BEFORE the lookup, not just before the write.
    await expect(
      service.createExperience({ input: VALID_INPUT, user: VIEWER }),
    ).rejects.toThrow("Forbidden")
    expect(prisma.experienceLocale.findFirst).not.toHaveBeenCalled()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("PUBLIC cannot create — rejected before the slug probe runs", async () => {
    await expect(
      service.createExperience({ input: VALID_INPUT, user: PUBLIC_USER }),
    ).rejects.toThrow("Forbidden")
    expect(prisma.experienceLocale.findFirst).not.toHaveBeenCalled()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("rejects blocks that fail the persistence BlocksSchema and persists nothing", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)

    await expect(
      service.createExperience({
        input: {
          ...VALID_INPUT,
          blocks: [{ t: "nonexistent_block_type" }],
        },
        user: ADMIN,
      }),
    ).rejects.toThrow()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("rejects unknown fields loudly instead of silently dropping them", async () => {
    // CreateExperienceInput STRIPS unknown keys; the tool schema is `.strict()`
    // so a caller passing metaDescription gets an error, not silent data loss.
    await expect(
      service.createExperience({
        input: { ...VALID_INPUT, metaDescription: "would be dropped" },
        user: ADMIN,
      }),
    ).rejects.toThrow()
    expect(prisma.experienceLocale.findFirst).not.toHaveBeenCalled()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("rejects an empty title", async () => {
    await expect(
      service.createExperience({
        input: { ...VALID_INPUT, title: "" },
        user: ADMIN,
      }),
    ).rejects.toThrow()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("reports the existing resource on a duplicate (locale, slug) instead of creating a second draft", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce({
      id: "loc-existing",
      experienceId: "exp-existing",
      status: "DRAFT",
    })

    await expect(
      service.createExperience({ input: VALID_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "slug_exists",
      retryable: false,
      conflict: {
        locale: "en",
        slug: "hope",
        existingExperienceId: "exp-existing",
        existingLocaleId: "loc-existing",
        existingStatus: "DRAFT",
      },
    })
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("accepts a large non-Latin blocks payload (3-byte script)", async () => {
    // ~17k CJK chars ≈ 51KB of UTF-8 — the whole JSON-RPC envelope stays
    // under the route's 64KB cap while proving byte-heavy scripts validate.
    const cjkParagraph = "あ".repeat(17_000)
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockResolvedValueOnce(CREATED_EXPERIENCE)

    await expect(
      service.createExperience({
        input: {
          ...VALID_INPUT,
          blocks: [{ t: "text", contentParagraphs: [cjkParagraph] }],
        },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({ ok: true })

    expect(prisma.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locales: expect.objectContaining({
            create: expect.objectContaining({
              blocks: [
                expect.objectContaining({
                  contentParagraphs: [cjkParagraph],
                }),
              ],
            }),
          }),
        }),
      }),
    )
  })
})

const VALID_DRAFT: DraftExperience = {
  title: "Hope in Hard Times",
  metaDescription: "A page about hope.",
  blocks: [
    { t: "text", heading: "Hope", contentParagraphs: ["p1"] },
    { t: "text", heading: "More hope", contentParagraphs: ["p2"] },
  ],
}

const GENERATE_INPUT = {
  topic: "Hope in Hard Times",
  locale: "en",
}

const GENERATION_CONFIG = {
  baseUrl: "http://mastra.test",
  bearer: "svc-key",
}

function okDraftLaunch() {
  return vi.fn(async () => ({ ok: true as const, draft: VALID_DRAFT }))
}

function okVariantLaunch(personaId = "grieving") {
  return vi.fn(async () => ({
    ok: true as const,
    draft: VALID_DRAFT,
    personaId,
  }))
}

describe("ExperienceMcpService.generateExperience", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  function makeService(overrides: Record<string, unknown> = {}) {
    return new ExperienceMcpService(prisma, {
      loadCandidates: vi.fn(async () => []),
      launchDraft: okDraftLaunch(),
      launchVariant: okVariantLaunch(),
      generationConfig: GENERATION_CONFIG,
      ...overrides,
    })
  }

  function primeHappyPersistence() {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockResolvedValueOnce(CREATED_EXPERIENCE)
    prisma.experienceLocaleUpdate.mockResolvedValueOnce({
      ...CREATED_LOCALE,
      metaDescription: "A page about hope.",
    })
  }

  it("short-circuits to config_missing before any candidates or mastra call", async () => {
    const loadCandidates = vi.fn(async () => [])
    const launchDraft = okDraftLaunch()
    // No generationConfig override: env vars are undefined under the test
    // env's skipValidation, which is exactly the unconfigured deployment.
    const service = new ExperienceMcpService(prisma, {
      loadCandidates,
      launchDraft,
    })

    await expect(
      service.generateExperience({ input: GENERATE_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(loadCandidates).not.toHaveBeenCalled()
    expect(launchDraft).not.toHaveBeenCalled()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("reports the existing resource on a slug conflict before spending tokens", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce({
      id: "loc-existing",
      experienceId: "exp-existing",
      status: "PUBLISHED",
    })
    const launchDraft = okDraftLaunch()
    const service = makeService({ launchDraft })

    await expect(
      service.generateExperience({ input: GENERATE_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "slug_exists",
      retryable: false,
      conflict: {
        existingExperienceId: "exp-existing",
        existingLocaleId: "loc-existing",
        existingStatus: "PUBLISHED",
        slug: "hope-in-hard-times",
      },
    })
    expect(launchDraft).not.toHaveBeenCalled()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("maps a candidate-loader failure to candidates_failed without calling mastra", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    const launchDraft = okDraftLaunch()
    const service = makeService({
      loadCandidates: vi.fn(async () => {
        throw new Error("pgvector down")
      }),
      launchDraft,
    })

    await expect(
      service.generateExperience({ input: GENERATE_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "candidates_failed",
      retryable: true,
    })
    expect(launchDraft).not.toHaveBeenCalled()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it.each([
    ["timeout", true],
    ["auth_failed", false],
    ["generation_failed", false],
  ] as const)(
    "passes through the mastra %s envelope and persists nothing",
    async (reason, retryable) => {
      prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
      const service = makeService({
        launchDraft: vi.fn(async () => ({
          ok: false as const,
          reason,
          retryable,
        })),
      })

      await expect(
        service.generateExperience({ input: GENERATE_INPUT, user: ADMIN }),
      ).resolves.toMatchObject({ ok: false, reason, retryable })
      expect(prisma.experience.create).not.toHaveBeenCalled()
    },
  )

  it("names the persona in the invalid_input failure message", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    const launchVariant = vi.fn(async () => ({
      ok: false as const,
      reason: "invalid_input" as const,
      retryable: false,
    }))
    const service = makeService({ launchVariant })

    const result = await service.generateExperience({
      input: { ...GENERATE_INPUT, personaId: "not-a-persona" },
      user: ADMIN,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
    expect((result as { message?: string }).message ?? "").toContain(
      "not-a-persona",
    )
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("maps a below-minimum draft to normalization_failed (real normalize gate)", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    const thin: DraftExperience = {
      title: "x",
      metaDescription: "y",
      blocks: [{ t: "text", heading: "h", contentParagraphs: ["p"] }],
    }
    const service = makeService({
      launchDraft: vi.fn(async () => ({ ok: true as const, draft: thin })),
    })

    await expect(
      service.generateExperience({ input: GENERATE_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "normalization_failed",
      retryable: false,
      normalizationCode: "BELOW_MIN_BLOCKS",
    })
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("maps an off-grounding video ref to normalization_failed with its code", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    const offGrounding = {
      title: "x",
      metaDescription: "y",
      blocks: [
        { t: "video", candidateRef: "v99" },
        { t: "text", heading: "h", contentParagraphs: ["p"] },
      ],
    } as unknown as DraftExperience
    const service = makeService({
      launchDraft: vi.fn(async () => ({
        ok: true as const,
        draft: offGrounding,
      })),
    })

    await expect(
      service.generateExperience({ input: GENERATE_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "normalization_failed",
      normalizationCode: "UNKNOWN_VIDEO_REF",
    })
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("maps a persistence failure to persist_failed", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockRejectedValueOnce(new Error("db down"))
    const service = makeService()

    await expect(
      service.generateExperience({ input: GENERATE_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "persist_failed",
      retryable: false,
    })
  })

  it("generates via the quick draft route and persists a DRAFT with AI provenance", async () => {
    primeHappyPersistence()
    const loadCandidates = vi.fn(async () => [])
    const launchDraft = okDraftLaunch()
    const launchVariant = okVariantLaunch()
    const service = makeService({ loadCandidates, launchDraft, launchVariant })

    const result = await service.generateExperience({
      input: GENERATE_INPUT,
      user: ADMIN,
    })

    expect(result).toMatchObject({
      ok: true,
      experience: { id: "exp-1", ownerId: "admin-1" },
      locale: { status: "DRAFT", metaDescription: "A page about hope." },
      editorUrl: "http://localhost:3003/dashboard/experiences/exp-1?locale=en",
      provenance: {
        source: "mastra-quick-draft",
        topic: "Hope in Hard Times",
      },
    })
    expect(launchVariant).not.toHaveBeenCalled()
    expect(launchDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Hope in Hard Times",
        locale: "en",
        mode: "quick",
      }),
      expect.objectContaining({
        baseUrl: "http://mastra.test",
        bearer: "svc-key",
        timeoutMs: 90_000,
      }),
    )
    expect(prisma.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "admin-1",
          locales: expect.objectContaining({
            create: expect.objectContaining({
              slug: "hope-in-hard-times",
              title: "Hope in Hard Times",
            }),
          }),
        }),
      }),
    )
    expect(prisma.contentRevisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "ExperienceLocale",
          entityId: "loc-en",
          revisedBy: "admin-1",
          revisedByKind: "AI",
          reason: expect.stringContaining("experience.generate"),
          // The provenance snapshot records the FULL generated draft as
          // born, including the AI metaDescription.
          snapshot: expect.objectContaining({
            data: expect.objectContaining({
              metaDescription: "A page about hope.",
            }),
          }),
        }),
      }),
    )
    expect(prisma.experienceLocaleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "loc-en" },
        data: { metaDescription: "A page about hope." },
      }),
    )
  })

  it("routes through the persona variant path when personaId is present", async () => {
    primeHappyPersistence()
    const launchDraft = okDraftLaunch()
    const launchVariant = okVariantLaunch("grieving")
    const service = makeService({ launchDraft, launchVariant })

    const result = await service.generateExperience({
      input: { ...GENERATE_INPUT, personaId: "grieving" },
      user: ADMIN,
    })

    expect(result).toMatchObject({
      ok: true,
      provenance: {
        source: "mastra-persona-variant",
        personaId: "grieving",
      },
    })
    expect(launchDraft).not.toHaveBeenCalled()
    expect(launchVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "Hope in Hard Times",
        personaId: "grieving",
      }),
      expect.objectContaining({ timeoutMs: 90_000 }),
    )
    // Derived slug carries the persona suffix so persona variants of the
    // same topic do not collide.
    expect(prisma.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locales: expect.objectContaining({
            create: expect.objectContaining({
              slug: "hope-in-hard-times-grieving",
            }),
          }),
        }),
      }),
    )
  })

  it("uses a caller-supplied slug verbatim", async () => {
    primeHappyPersistence()
    const service = makeService()

    await service.generateExperience({
      input: { ...GENERATE_INPUT, slug: "esperanza-2026" },
      user: ADMIN,
    })

    expect(prisma.experience.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locales: expect.objectContaining({
            create: expect.objectContaining({ slug: "esperanza-2026" }),
          }),
        }),
      }),
    )
  })

  it("threads a sanitized exemplar outline into the launcher", async () => {
    // findFirst #1: slug-conflict check → none. findFirst #2: exemplar row.
    prisma.experienceLocale.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        title: "Exemplar page",
        metaDescription: "Exemplar meta",
        blocks: [{ t: "text", heading: "Exemplar heading" }],
      })
    prisma.experience.create.mockResolvedValueOnce(CREATED_EXPERIENCE)
    prisma.experienceLocaleUpdate.mockResolvedValueOnce(CREATED_LOCALE)
    const launchDraft = okDraftLaunch()
    const service = makeService({ launchDraft })

    await service.generateExperience({
      input: { ...GENERATE_INPUT, exemplarExperienceId: "exp-exemplar" },
      user: ADMIN,
    })

    expect(launchDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        exemplar: expect.stringContaining("Exemplar heading"),
      }),
      expect.anything(),
    )
  })

  it("throws NotFound for an unknown exemplarExperienceId before spending tokens", async () => {
    prisma.experienceLocale.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const launchDraft = okDraftLaunch()
    const service = makeService({ launchDraft })

    await expect(
      service.generateExperience({
        input: { ...GENERATE_INPUT, exemplarExperienceId: "exp-missing" },
        user: ADMIN,
      }),
    ).rejects.toThrow("Experience not found: exp-missing")
    expect(launchDraft).not.toHaveBeenCalled()
    expect(prisma.experience.create).not.toHaveBeenCalled()
  })

  it("skips the metaDescription update when the generated meta is empty but still writes the revision", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockResolvedValueOnce(CREATED_EXPERIENCE)
    const whitespaceMeta: DraftExperience = {
      ...VALID_DRAFT,
      metaDescription: "   ",
    }
    const service = makeService({
      launchDraft: vi.fn(async () => ({
        ok: true as const,
        draft: whitespaceMeta,
      })),
    })

    const result = await service.generateExperience({
      input: GENERATE_INPUT,
      user: ADMIN,
    })

    expect(result).toMatchObject({ ok: true })
    expect(prisma.experienceLocaleUpdate).not.toHaveBeenCalled()
    expect(prisma.contentRevisionCreate).toHaveBeenCalled()
  })

  it("clamps a persona-derived slug to the 200-char create cap before any paid work", async () => {
    primeHappyPersistence()
    const service = makeService()

    await service.generateExperience({
      input: {
        ...GENERATE_INPUT,
        topic: "h".repeat(200),
        personaId: "grieving",
      },
      user: ADMIN,
    })

    const probed = prisma.experienceLocale.findFirst.mock.calls[0][0].where.slug
    expect(probed.length).toBeLessThanOrEqual(200)
    expect(probed.endsWith("-grieving")).toBe(true)
  })

  it("reports persist_failed when the atomic transaction rejects (nothing partially persisted)", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    prisma.experience.create.mockResolvedValueOnce(CREATED_EXPERIENCE)
    prisma.contentRevisionCreate.mockRejectedValueOnce(new Error("db blip"))
    const service = makeService()

    await expect(
      service.generateExperience({ input: GENERATE_INPUT, user: ADMIN }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "persist_failed",
      retryable: false,
    })
    // The create ran INSIDE the same transaction as the failing revision
    // write, so the rejection rolls the whole persist back in production.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it("sanitizes CR/LF out of error messages in plain-string logs", async () => {
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(null)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const service = makeService({
        loadCandidates: vi.fn(async () => {
          throw new Error("first line\r\nevent=forged_entry injected=true")
        }),
      })

      await service.generateExperience({ input: GENERATE_INPUT, user: ADMIN })

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const logged = errorSpy.mock.calls[0][0] as string
      expect(logged).toContain("event=candidates_error")
      expect(logged).not.toMatch(/[\r\n]/)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("VIEWER cannot generate and no paid work happens", async () => {
    const loadCandidates = vi.fn(async () => [])
    const launchDraft = okDraftLaunch()
    const service = makeService({ loadCandidates, launchDraft })

    await expect(
      service.generateExperience({ input: GENERATE_INPUT, user: VIEWER }),
    ).rejects.toThrow("Forbidden")
    expect(prisma.experienceLocale.findFirst).not.toHaveBeenCalled()
    expect(loadCandidates).not.toHaveBeenCalled()
    expect(launchDraft).not.toHaveBeenCalled()
  })
})
