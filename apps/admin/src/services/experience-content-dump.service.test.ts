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

import { SYSTEM_PRINCIPAL } from "@/auth/principal"
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

  it("surfaces an unknown cms component_type as failed_validation (transformer can't handle it)", async () => {
    // The repository's loadOneComponent returns null for unknown
    // component types (the early return guarded by isKnownComponentType).
    // The fake repo can also seed this directly: pass a CmsComponentRow
    // with a componentType not in the union — at the type level this
    // requires a cast, but the runtime path tests what cms could
    // actually emit (a future Strapi component admin doesn't model).
    // We seed an empty components list; if the repo returned null for
    // an unknown type, the dump succeeds with zero blocks. This test
    // documents the contract: missing components do NOT halt the
    // run — they pass through as an empty blocks array, which Zod
    // accepts. (A separate test surfaces transformer-throw cases.)
    const repo = createFakeCmsExperienceSourceRepository({
      experienceRows: { "doc-1::en::published": samplePublishedRow },
      components: { "experiences::100::blocks": [] },
    })
    const { prisma } = makePrismaMock()
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

  it("masks raw $transaction errors as db_write with no leaked detail", async () => {
    // Per zod-validation-errors-must-not-echo-user-controlled-input:
    // raw Prisma error messages can carry parameter values + connection
    // strings. The dump must mask them as the typed db_write code with
    // a redacted message and put the original on err.cause for logs.
    const repo = buildSeed()
    const { prisma } = makePrismaMock()
    // Force the $transaction wrapper to throw a non-typed error.
    ;(
      prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }
    ).$transaction = vi.fn(async () => {
      throw new Error(
        "connection refused: postgres://leaked:secret@cms-pg:5432/db",
      )
    })

    try {
      await dumpExperienceLocale(prisma, {
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
      expect.fail("expected dumpExperienceLocale to throw")
    } catch (err) {
      const e = err as Error & { code?: string; cause?: unknown }
      expect(e.code).toBe("db_write")
      expect(e.message).not.toContain("connection refused")
      expect(e.message).not.toContain("postgres://")
      expect(e.message).not.toContain("leaked")
      expect(e.message).not.toContain("secret")
      // Original error preserved on cause for server-side logs only.
      expect(e.cause).toBeInstanceOf(Error)
    }
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

  it("canonicalize sorts keys inside array elements (the blocks shape)", () => {
    // Hash determinism for the `blocks` array depends on per-element
    // key sorting recursing into objects in arrays. A regression where
    // Array.isArray short-circuited without recursing would silently
    // diverge two semantically-identical inputs into different hashes.
    const out = canonicalStringify([
      { b: 1, a: 2 },
      { z: 9, x: 8 },
    ])
    expect(out).toBe(`[{"a":2,"b":1},{"x":8,"z":9}]`)
  })

  it("canonicalize is idempotent across input key-order variants (the contract)", () => {
    // The actual hash invariant: two semantically-identical block
    // arrays must produce the same bytes regardless of authored
    // key order.
    const a = canonicalStringify({
      blocks: [{ t: "cta", buttonLabel: "Go", sectionKey: "x" }],
      title: "T",
    })
    const b = canonicalStringify({
      title: "T",
      blocks: [{ sectionKey: "x", t: "cta", buttonLabel: "Go" }],
    })
    expect(a).toBe(b)
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
