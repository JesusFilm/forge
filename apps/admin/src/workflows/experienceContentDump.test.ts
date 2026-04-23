// Body tests for runExperienceContentDump workflow.
//
// The workflow body is exercised in vitest's inert-directive mode
// (the `"use workflow"` and `"use step"` directives are no-ops in
// tests). This suite covers the in-process composition + outcome
// classification. The dispatch boundary (resolver → workflow via
// `start()`) is tested separately in
// `src/graphql/mutations/experience-content-dump.test.ts` to catch
// the workflow-dispatch-test-mode-divergence class of bug.
//
// The workflow's embed-dispatch step uses the same `start()` from
// `workflow/api` — that boundary IS exercised here via
// wrapStartSpy, so a missing dispatch wrapper around
// runExperienceEmbedding is also caught at test time.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const { start } = vi.hoisted(() => ({ start: vi.fn() }))

vi.mock("workflow/api", () => ({ start }))

const cmsPgMocks = vi.hoisted(() => ({
  getCmsPgPool: vi.fn(() => ({}) as unknown),
}))

vi.mock("@/db/cms-pg", () => cmsPgMocks)

const repoMocks = vi.hoisted(() => ({
  createCmsExperienceSourceRepository: vi.fn(),
}))

vi.mock("@/services/cms-experience-source.repository", () => repoMocks)

const videoResolverMocks = vi.hoisted(() => ({
  createCmsVideoIdResolver: vi.fn(),
}))

vi.mock("@/services/cms-video-id-resolver", () => videoResolverMocks)

const serviceMocks = vi.hoisted(() => ({
  dumpExperienceLocale: vi.fn(),
  persistContentHash: vi.fn(async () => undefined),
  ExperienceContentDumpError: class extends Error {
    code: string
    constructor(args: { code: string; message: string }) {
      super(args.message)
      this.code = args.code
      this.name = "ExperienceContentDumpError"
    }
  },
}))

vi.mock("@/services/experience-content-dump.service", () => serviceMocks)

vi.mock("@/db/client", () => ({
  prisma: {} as unknown,
}))

import {
  runExperienceContentDump,
  type ExperienceContentDumpReport,
} from "./experienceContentDump"
import { runExperienceEmbedding } from "./experienceEmbedding"
import { createFakeCmsExperienceSourceRepository } from "@/services/cms-experience-source.fake"

const dispatch = wrapStartSpy<{
  localeId: string
  dimensions: number
  model: string
  updated: boolean
}>(start)

describe("runExperienceContentDump", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns a 0-target report when cms enumeration is empty", async () => {
    const fakeRepo = createFakeCmsExperienceSourceRepository({
      documentLocales: [],
    })
    repoMocks.createCmsExperienceSourceRepository.mockReturnValue(fakeRepo)
    videoResolverMocks.createCmsVideoIdResolver.mockReturnValue({
      resolve: vi.fn(async () => new Map()),
    })

    const report = await runExperienceContentDump({})

    expect(report.totalTargets).toBe(0)
    expect(report.outcomes).toEqual([])
    expect(report.succeeded).toBe(0)
    expect(report.failed).toBe(0)
    expect(report.embedsDispatched).toBe(0)
    expect(serviceMocks.dumpExperienceLocale).not.toHaveBeenCalled()
    dispatch.expectNotDispatched()
  })

  it("dumps a target and dispatches embed via start() for created/updated outcomes", async () => {
    const fakeRepo = createFakeCmsExperienceSourceRepository({
      documentLocales: [
        {
          document_id: "doc-1",
          locale: "en",
          has_published: true,
          has_draft: false,
          published_at: new Date("2026-04-20T10:00:00Z"),
          draft_updated_at: null,
        },
      ],
    })
    repoMocks.createCmsExperienceSourceRepository.mockReturnValue(fakeRepo)
    videoResolverMocks.createCmsVideoIdResolver.mockReturnValue({
      resolve: vi.fn(async () => new Map()),
    })
    serviceMocks.dumpExperienceLocale.mockResolvedValue({
      experienceLocaleId: "loc-1",
      experienceId: "exp-1",
      status: "PUBLISHED",
      action: "created",
      newHash: "abc123",
      previousHash: null,
      draftPendingNewer: false,
      videoResolutionMisses: [],
    })
    dispatch.mockReturnValue({
      localeId: "loc-1",
      dimensions: 1536,
      model: "text-embedding-3-small",
      updated: true,
    })

    const report = await runExperienceContentDump({})

    expect(report.totalTargets).toBe(1)
    expect(report.succeeded).toBe(1)
    expect(report.embedsDispatched).toBe(1)

    dispatch.expectDispatched(runExperienceEmbedding, [{ localeId: "loc-1" }])
    expect(serviceMocks.persistContentHash).toHaveBeenCalledWith(
      expect.anything(),
      "loc-1",
      "abc123",
    )

    const outcome = report.outcomes[0]!
    expect(outcome.status).toBe("succeeded")
    if (outcome.status === "succeeded") {
      expect(outcome.embedDispatched).toBe(true)
    }
  })

  it("does not dispatch embed for skipped_unchanged outcomes", async () => {
    const fakeRepo = createFakeCmsExperienceSourceRepository({
      documentLocales: [
        {
          document_id: "doc-2",
          locale: "en",
          has_published: true,
          has_draft: false,
          published_at: new Date("2026-04-20T10:00:00Z"),
          draft_updated_at: null,
        },
      ],
    })
    repoMocks.createCmsExperienceSourceRepository.mockReturnValue(fakeRepo)
    videoResolverMocks.createCmsVideoIdResolver.mockReturnValue({
      resolve: vi.fn(async () => new Map()),
    })
    serviceMocks.dumpExperienceLocale.mockResolvedValue({
      experienceLocaleId: "loc-2",
      experienceId: "exp-2",
      status: "PUBLISHED",
      action: "skipped_unchanged",
      newHash: "samehash",
      previousHash: "samehash",
      draftPendingNewer: false,
      videoResolutionMisses: [],
    })

    const report = await runExperienceContentDump({})

    expect(report.skipped).toBe(1)
    expect(report.embedsDispatched).toBe(0)
    dispatch.expectNotDispatched()
    expect(serviceMocks.persistContentHash).not.toHaveBeenCalled()
  })

  it("flips outcome to failed (embed_dispatch_failed) when start() rejects + leaves hash unpersisted", async () => {
    const fakeRepo = createFakeCmsExperienceSourceRepository({
      documentLocales: [
        {
          document_id: "doc-3",
          locale: "en",
          has_published: true,
          has_draft: false,
          published_at: new Date("2026-04-20T10:00:00Z"),
          draft_updated_at: null,
        },
      ],
    })
    repoMocks.createCmsExperienceSourceRepository.mockReturnValue(fakeRepo)
    videoResolverMocks.createCmsVideoIdResolver.mockReturnValue({
      resolve: vi.fn(async () => new Map()),
    })
    serviceMocks.dumpExperienceLocale.mockResolvedValue({
      experienceLocaleId: "loc-3",
      experienceId: "exp-3",
      status: "PUBLISHED",
      action: "updated",
      newHash: "newhash",
      previousHash: "oldhash",
      draftPendingNewer: false,
      videoResolutionMisses: [],
    })
    // start() throws
    dispatch.mockRejection(new Error("workflow runtime down"))

    const report = await runExperienceContentDump({})

    expect(report.failed).toBe(1)
    expect(report.embedsDispatched).toBe(0)
    expect(serviceMocks.persistContentHash).not.toHaveBeenCalled()
    const outcome = report.outcomes[0]!
    expect(outcome.status).toBe("failed")
    if (outcome.status === "failed") {
      expect(outcome.reason).toBe("embed_dispatch_failed")
    }
  })

  it("classifies a typed ExperienceContentDumpError as the matching reason", async () => {
    const fakeRepo = createFakeCmsExperienceSourceRepository({
      documentLocales: [
        {
          document_id: "doc-4",
          locale: "en",
          has_published: true,
          has_draft: false,
          published_at: new Date("2026-04-20T10:00:00Z"),
          draft_updated_at: null,
        },
      ],
    })
    repoMocks.createCmsExperienceSourceRepository.mockReturnValue(fakeRepo)
    videoResolverMocks.createCmsVideoIdResolver.mockReturnValue({
      resolve: vi.fn(async () => new Map()),
    })
    serviceMocks.dumpExperienceLocale.mockRejectedValue(
      new serviceMocks.ExperienceContentDumpError({
        code: "slug_collision",
        message: "two docs publish the same slug",
      }),
    )

    const report = await runExperienceContentDump({})

    expect(report.failed).toBe(1)
    const outcome = report.outcomes[0]!
    expect(outcome.status).toBe("failed")
    if (outcome.status === "failed") {
      expect(outcome.reason).toBe("slug_collision")
    }
    dispatch.expectNotDispatched()
  })

  it("filters out targets with empty locale strings (data-quality guard)", async () => {
    const fakeRepo = createFakeCmsExperienceSourceRepository({
      documentLocales: [
        {
          document_id: "doc-5",
          locale: "",
          has_published: true,
          has_draft: false,
          published_at: new Date("2026-04-20T10:00:00Z"),
          draft_updated_at: null,
        },
      ],
    })
    repoMocks.createCmsExperienceSourceRepository.mockReturnValue(fakeRepo)
    videoResolverMocks.createCmsVideoIdResolver.mockReturnValue({
      resolve: vi.fn(async () => new Map()),
    })

    const report = await runExperienceContentDump({})
    expect(report.totalTargets).toBe(0)
    expect(serviceMocks.dumpExperienceLocale).not.toHaveBeenCalled()
  })

  it("treats length-0 filter arrays as omitted (parity with R1/R2)", async () => {
    const fakeRepo = createFakeCmsExperienceSourceRepository({
      documentLocales: [],
    })
    const enumerateSpy = vi.spyOn(fakeRepo, "enumerateDocumentLocales")
    repoMocks.createCmsExperienceSourceRepository.mockReturnValue(fakeRepo)
    videoResolverMocks.createCmsVideoIdResolver.mockReturnValue({
      resolve: vi.fn(async () => new Map()),
    })

    await runExperienceContentDump({ documentIds: [], locales: [] })

    expect(enumerateSpy).toHaveBeenCalledWith({
      documentIds: undefined,
      locales: undefined,
    })
  })

  it("propagates supplied filter args to the enumeration step", async () => {
    const fakeRepo = createFakeCmsExperienceSourceRepository({
      documentLocales: [],
    })
    const enumerateSpy = vi.spyOn(fakeRepo, "enumerateDocumentLocales")
    repoMocks.createCmsExperienceSourceRepository.mockReturnValue(fakeRepo)
    videoResolverMocks.createCmsVideoIdResolver.mockReturnValue({
      resolve: vi.fn(async () => new Map()),
    })

    await runExperienceContentDump({
      documentIds: ["a", "b"],
      locales: ["en"],
    })

    expect(enumerateSpy).toHaveBeenCalledWith({
      documentIds: ["a", "b"],
      locales: ["en"],
    })
  })

  it("report.localeFilter / documentIdFilter reflect inputs verbatim or null when omitted", async () => {
    const fakeRepo = createFakeCmsExperienceSourceRepository({
      documentLocales: [],
    })
    repoMocks.createCmsExperienceSourceRepository.mockReturnValue(fakeRepo)
    videoResolverMocks.createCmsVideoIdResolver.mockReturnValue({
      resolve: vi.fn(async () => new Map()),
    })

    const r1: ExperienceContentDumpReport = await runExperienceContentDump({
      documentIds: ["x"],
      locales: ["en", "es"],
    })
    expect(r1.documentIdFilter).toEqual(["x"])
    expect(r1.localeFilter).toEqual(["en", "es"])

    const r2 = await runExperienceContentDump({})
    expect(r2.documentIdFilter).toBeNull()
    expect(r2.localeFilter).toBeNull()
  })
})
