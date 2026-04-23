// Tests for the experience-content-dump service.
//
// Service-level tests use the in-memory repository fake + a mocked
// Prisma client. The real repository's SQL behaviour is covered at
// deploy time per the runbook; this suite covers the dump pipeline
// (transform → validate → hash → upsert) end-to-end.

import { describe, expect, it, vi } from "vitest"
import { createFakeCmsExperienceSourceRepository } from "./cms-experience-source.fake"
import {
  _internals,
  canonicalStringify,
  dumpExperienceLocale,
  persistContentHash,
} from "./experience-content-dump.service"
import type { CmsCta, CmsExperienceRow } from "./cms-experience-source.types"
import type { CmsVideoIdResolver } from "./cms-video-id-resolver"

const SYSTEM_PRINCIPAL = { id: null, role: "SYSTEM" } as const
const VIEWER_PRINCIPAL = { id: "u1", role: "VIEWER" } as const

const noopVideoResolver: CmsVideoIdResolver = {
  async resolve(ids) {
    const out = new Map<
      number,
      { coreId: string | null; adminVideoId: string | null }
    >()
    for (const id of ids) out.set(id, { coreId: null, adminVideoId: null })
    return out
  },
}

const sampleCta: CmsCta = {
  componentType: "sections.cta",
  cmp_id: 1,
  section_key: null,
  heading: "Hi",
  body: "Body",
  button_label: "Go",
  button_link: "/go",
  variant: "primary",
}

const samplePublishedRow: CmsExperienceRow = {
  entity_id: 100,
  document_id: "doc-1",
  locale: "en",
  slug: "easter",
  is_homepage: false,
  is_template: false,
  title: "Easter",
  meta_description: "Meta",
  og_title: "OG",
  og_description: null,
  path_segment: null,
  published_at: new Date("2026-04-20T10:00:00Z"),
  created_at: new Date("2026-04-01T00:00:00Z"),
  updated_at: new Date("2026-04-20T10:00:00Z"),
}

function makePrismaMock(
  opts: {
    existingLocale?: {
      id: string
      experienceId: string
      cmsContentHash: string | null
    } | null
    existingExperienceForDocument?: { experienceId: string } | null
    collisionRow?: { id: string; cmsDocumentId: string | null } | null
  } = {},
) {
  const upsertedId = "loc-new-1"
  const createdExperienceId = "exp-new-1"

  const findFirstExperienceLocaleByDocument = vi.fn(async (_args?: unknown) =>
    opts.existingExperienceForDocument
      ? { experienceId: opts.existingExperienceForDocument.experienceId }
      : null,
  )
  const findFirstExperienceLocaleByDocumentLocale = vi.fn(
    async (_args?: unknown) => opts.existingLocale ?? null,
  )
  const updateExperienceLocale = vi.fn(async (_args?: unknown) => ({
    id: "stub",
  }))
  const upsertExperienceLocale = vi.fn(async (_args?: unknown) => ({
    id: upsertedId,
  }))
  const findFirstCollision = vi.fn(
    async (_args?: unknown) => opts.collisionRow ?? null,
  )
  const updateExperience = vi.fn(async (_args?: unknown) => ({ id: "stub" }))
  const createExperience = vi.fn(async (_args?: unknown) => ({
    id: createdExperienceId,
  }))

  const transactionFn = vi.fn(
    async (
      cb: (tx: unknown) => Promise<unknown>,
      _opts?: { timeout?: number },
    ) => {
      const tx = {
        experience: {
          create: createExperience,
          update: updateExperience,
        },
        experienceLocale: {
          findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
            // The slug-collision lookup uses a different shape; route
            // by presence of `status`.
            if (args.where.status !== undefined) return findFirstCollision(args)
            return findFirstExperienceLocaleByDocument(args)
          }),
          upsert: upsertExperienceLocale,
        },
      }
      return cb(tx)
    },
  )

  const prisma = {
    experienceLocale: {
      findFirst: findFirstExperienceLocaleByDocumentLocale,
      update: updateExperienceLocale,
    },
    $transaction: transactionFn,
  } as unknown as import("@prisma/client").PrismaClient

  return {
    prisma,
    spies: {
      findFirstExperienceLocaleByDocumentLocale,
      findFirstExperienceLocaleByDocument,
      updateExperienceLocale,
      upsertExperienceLocale,
      findFirstCollision,
      updateExperience,
      createExperience,
      transactionFn,
    },
    upsertedId,
    createdExperienceId,
  }
}

function buildSeed(opts?: { extraComponents?: CmsCta[] }) {
  return createFakeCmsExperienceSourceRepository({
    documentLocales: [
      {
        document_id: "doc-1",
        locale: "en",
        has_published: true,
        has_draft: false,
        published_at: samplePublishedRow.published_at,
        draft_updated_at: null,
      },
    ],
    experienceRows: {
      "doc-1::en::published": samplePublishedRow,
    },
    components: {
      "experiences::100::blocks": [sampleCta, ...(opts?.extraComponents ?? [])],
    },
  })
}

describe("dumpExperienceLocale — happy path + ABAC", () => {
  it("rejects non-SYSTEM/non-ADMIN principals with forbidden", async () => {
    const repo = buildSeed()
    const { prisma } = makePrismaMock()
    await expect(
      dumpExperienceLocale(prisma, {
        documentId: "doc-1",
        locale: "en",
        hasPublished: true,
        hasDraft: false,
        publishedAt: samplePublishedRow.published_at,
        draftUpdatedAt: null,
        user: VIEWER_PRINCIPAL,
        repo,
        videoResolver: noopVideoResolver,
      }),
    ).rejects.toMatchObject({
      name: "ExperienceContentDumpError",
      code: "forbidden",
    })
  })

  it("dumps a fresh locale → action=created with hash + Experience created", async () => {
    const repo = buildSeed()
    const { prisma, spies, upsertedId, createdExperienceId } = makePrismaMock()
    const result = await dumpExperienceLocale(prisma, {
      documentId: "doc-1",
      locale: "en",
      hasPublished: true,
      hasDraft: false,
      publishedAt: samplePublishedRow.published_at,
      draftUpdatedAt: null,
      user: SYSTEM_PRINCIPAL,
      repo,
      videoResolver: noopVideoResolver,
    })
    expect(result.action).toBe("created")
    expect(result.status).toBe("PUBLISHED")
    expect(result.experienceLocaleId).toBe(upsertedId)
    expect(result.experienceId).toBe(createdExperienceId)
    expect(result.previousHash).toBeNull()
    expect(result.newHash).toMatch(/^[0-9a-f]{64}$/)
    expect(spies.createExperience).toHaveBeenCalledOnce()
    expect(spies.upsertExperienceLocale).toHaveBeenCalledOnce()
  })

  it("dumps a locale with status=DRAFT when only draft exists", async () => {
    const draftRow: CmsExperienceRow = {
      ...samplePublishedRow,
      published_at: null,
    }
    const repo = createFakeCmsExperienceSourceRepository({
      experienceRows: { "doc-1::en::draft": draftRow },
      components: { "experiences::100::blocks": [] },
    })
    const { prisma } = makePrismaMock()
    const result = await dumpExperienceLocale(prisma, {
      documentId: "doc-1",
      locale: "en",
      hasPublished: false,
      hasDraft: true,
      publishedAt: null,
      draftUpdatedAt: new Date("2026-04-22T00:00:00Z"),
      user: SYSTEM_PRINCIPAL,
      repo,
      videoResolver: noopVideoResolver,
    })
    expect(result.status).toBe("DRAFT")
  })

  it("draftPendingNewer is true when both states exist and draft is newer", async () => {
    const repo = buildSeed()
    const { prisma } = makePrismaMock()
    const result = await dumpExperienceLocale(prisma, {
      documentId: "doc-1",
      locale: "en",
      hasPublished: true,
      hasDraft: true,
      publishedAt: new Date("2026-04-20T10:00:00Z"),
      draftUpdatedAt: new Date("2026-04-22T15:00:00Z"),
      user: SYSTEM_PRINCIPAL,
      repo,
      videoResolver: noopVideoResolver,
    })
    expect(result.draftPendingNewer).toBe(true)
  })

  it("returns skipped_unchanged when previous hash matches", async () => {
    const repo = buildSeed()
    // First run to discover the hash.
    const first = await dumpExperienceLocale(makePrismaMock().prisma, {
      documentId: "doc-1",
      locale: "en",
      hasPublished: true,
      hasDraft: false,
      publishedAt: samplePublishedRow.published_at,
      draftUpdatedAt: null,
      user: SYSTEM_PRINCIPAL,
      repo,
      videoResolver: noopVideoResolver,
    })
    // Second run with existing row carrying the same hash.
    const { prisma, spies } = makePrismaMock({
      existingLocale: {
        id: "loc-existing",
        experienceId: "exp-existing",
        cmsContentHash: first.newHash,
      },
    })
    const result = await dumpExperienceLocale(prisma, {
      documentId: "doc-1",
      locale: "en",
      hasPublished: true,
      hasDraft: false,
      publishedAt: samplePublishedRow.published_at,
      draftUpdatedAt: null,
      user: SYSTEM_PRINCIPAL,
      repo,
      videoResolver: noopVideoResolver,
    })
    expect(result.action).toBe("skipped_unchanged")
    expect(result.experienceLocaleId).toBe("loc-existing")
    expect(spies.upsertExperienceLocale).not.toHaveBeenCalled()
    expect(spies.updateExperienceLocale).toHaveBeenCalledOnce()
  })

  it("returns updated when previous hash differs", async () => {
    const repo = buildSeed()
    const { prisma, spies } = makePrismaMock({
      existingLocale: {
        id: "loc-existing",
        experienceId: "exp-existing",
        cmsContentHash: "stale-hash-value",
      },
      existingExperienceForDocument: { experienceId: "exp-existing" },
    })
    const result = await dumpExperienceLocale(prisma, {
      documentId: "doc-1",
      locale: "en",
      hasPublished: true,
      hasDraft: false,
      publishedAt: samplePublishedRow.published_at,
      draftUpdatedAt: null,
      user: SYSTEM_PRINCIPAL,
      repo,
      videoResolver: noopVideoResolver,
    })
    expect(result.action).toBe("updated")
    expect(result.previousHash).toBe("stale-hash-value")
    expect(spies.upsertExperienceLocale).toHaveBeenCalledOnce()
    // Existing experience reused; create not called.
    expect(spies.createExperience).not.toHaveBeenCalled()
  })
})

describe("dumpExperienceLocale — error paths", () => {
  it("throws null_locale on empty locale", async () => {
    const repo = buildSeed()
    const { prisma } = makePrismaMock()
    await expect(
      dumpExperienceLocale(prisma, {
        documentId: "doc-1",
        locale: "",
        hasPublished: true,
        hasDraft: false,
        publishedAt: samplePublishedRow.published_at,
        draftUpdatedAt: null,
        user: SYSTEM_PRINCIPAL,
        repo,
        videoResolver: noopVideoResolver,
      }),
    ).rejects.toMatchObject({ code: "null_locale" })
  })

  it("throws cms_read when source row is missing", async () => {
    const repo = createFakeCmsExperienceSourceRepository({})
    const { prisma } = makePrismaMock()
    await expect(
      dumpExperienceLocale(prisma, {
        documentId: "doc-missing",
        locale: "en",
        hasPublished: true,
        hasDraft: false,
        publishedAt: samplePublishedRow.published_at,
        draftUpdatedAt: null,
        user: SYSTEM_PRINCIPAL,
        repo,
        videoResolver: noopVideoResolver,
      }),
    ).rejects.toMatchObject({ code: "cms_read" })
  })

  it("throws failed_validation when a transformer rejects", async () => {
    // CTA missing buttonLabel → BlockTransformError
    const badCta: CmsCta = { ...sampleCta, button_label: null }
    const repo = createFakeCmsExperienceSourceRepository({
      experienceRows: { "doc-1::en::published": samplePublishedRow },
      components: { "experiences::100::blocks": [badCta] },
    })
    const { prisma } = makePrismaMock()
    await expect(
      dumpExperienceLocale(prisma, {
        documentId: "doc-1",
        locale: "en",
        hasPublished: true,
        hasDraft: false,
        publishedAt: samplePublishedRow.published_at,
        draftUpdatedAt: null,
        user: SYSTEM_PRINCIPAL,
        repo,
        videoResolver: noopVideoResolver,
      }),
    ).rejects.toMatchObject({
      code: "failed_validation",
    })
  })

  it("throws slug_collision when another doc owns the published (locale, slug)", async () => {
    const repo = buildSeed()
    const { prisma } = makePrismaMock({
      collisionRow: { id: "loc-other", cmsDocumentId: "doc-other" },
    })
    await expect(
      dumpExperienceLocale(prisma, {
        documentId: "doc-1",
        locale: "en",
        hasPublished: true,
        hasDraft: false,
        publishedAt: samplePublishedRow.published_at,
        draftUpdatedAt: null,
        user: SYSTEM_PRINCIPAL,
        repo,
        videoResolver: noopVideoResolver,
      }),
    ).rejects.toMatchObject({ code: "slug_collision" })
  })
})

describe("hash + canonicalization helpers", () => {
  it("canonicalize sorts object keys recursively", () => {
    const out = canonicalStringify({ b: 1, a: { y: 2, x: 1 } })
    expect(out).toBe(`{"a":{"x":1,"y":2},"b":1}`)
  })

  it("canonicalize preserves array order (positional content)", () => {
    expect(canonicalStringify([3, 1, 2])).toBe(`[3,1,2]`)
  })

  it("canonicalize omits undefined values (matches JSON.stringify)", () => {
    expect(canonicalStringify({ a: undefined, b: 1 })).toBe(`{"b":1}`)
  })

  it("sha256Hex produces deterministic 64-char hex", () => {
    const hex = _internals.sha256Hex("hello")
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
    expect(_internals.sha256Hex("hello")).toBe(hex)
  })

  it("computeDraftPendingNewer is false when one state is missing", () => {
    expect(
      _internals.computeDraftPendingNewer({
        hasDraft: false,
        hasPublished: true,
        publishedAt: new Date(),
        draftUpdatedAt: null,
      }),
    ).toBe(false)
    expect(
      _internals.computeDraftPendingNewer({
        hasDraft: true,
        hasPublished: false,
        publishedAt: null,
        draftUpdatedAt: new Date(),
      }),
    ).toBe(false)
  })

  it("computeDraftPendingNewer is true only when draft strictly newer", () => {
    expect(
      _internals.computeDraftPendingNewer({
        hasDraft: true,
        hasPublished: true,
        publishedAt: new Date("2026-04-20"),
        draftUpdatedAt: new Date("2026-04-22"),
      }),
    ).toBe(true)
    expect(
      _internals.computeDraftPendingNewer({
        hasDraft: true,
        hasPublished: true,
        publishedAt: new Date("2026-04-22"),
        draftUpdatedAt: new Date("2026-04-20"),
      }),
    ).toBe(false)
  })
})

describe("persistContentHash", () => {
  it("calls prisma.experienceLocale.update with the new hash", async () => {
    const update = vi.fn(async () => ({ id: "stub" }))
    const prisma = {
      experienceLocale: { update },
    } as unknown as import("@prisma/client").PrismaClient
    await persistContentHash(prisma, "loc-1", "deadbeef")
    expect(update).toHaveBeenCalledWith({
      where: { id: "loc-1" },
      data: { cmsContentHash: "deadbeef" },
      select: { id: true },
    })
  })
})
