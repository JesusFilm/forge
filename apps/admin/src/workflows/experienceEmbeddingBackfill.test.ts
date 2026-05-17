// Workflow-body tests for `runExperienceEmbeddingBackfill`.
//
// Asserts per-target dispatch + outcome aggregation + filter handling
// + per-target error isolation. The dispatch-site wiring of the
// resolver lives in
// `src/graphql/mutations/experience-embedding-backfill.test.ts` —
// `"use workflow"` is inert in tests, so the body executes directly
// here.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"

vi.mock("@/db/client", () => {
  const mock = {
    $queryRaw: vi.fn(async () => [] as unknown[]),
  }
  return { prisma: mock, syncPrisma: mock }
})

vi.mock("@/services/embeddings.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/embeddings.service")>()
  return {
    ...actual,
    embedExperienceLocale: vi.fn(async (localeId: string) => ({
      localeId,
      dimensions: 1536,
      model: "text-embedding-3-small",
    })),
  }
})

const { prisma } = await import("@/db/client")
const { runExperienceEmbeddingBackfill, _internals } =
  await import("./experienceEmbeddingBackfill")
const { embedExperienceLocale } = await import("@/services/embeddings.service")

type PrismaStub = { $queryRaw: ReturnType<typeof vi.fn> }
type EmbedStub = ReturnType<typeof vi.fn>

function row(id: string, experienceId: string, locale: string) {
  return { id, experience_id: experienceId, locale }
}

function embedStub() {
  return embedExperienceLocale as unknown as EmbedStub
}

describe("runExperienceEmbeddingBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
    embedStub().mockImplementation(async (localeId: string) => ({
      localeId,
      dimensions: 1536,
      model: "text-embedding-3-small",
    }))
  })

  it("returns a clean success-shaped report when zero rows are eligible", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([])

    const report = await runExperienceEmbeddingBackfill({})

    expect(report).toEqual({
      totalTargets: 0,
      experienceIdFilter: null,
      localeFilter: null,
      force: false,
      outcomes: [],
      succeeded: 0,
      failed: 0,
    })
    expect(embedStub()).not.toHaveBeenCalled()
  })

  it("calls embedExperienceLocale once per eligible target with the locale id", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("locale-a", "exp-1", "en"),
      row("locale-b", "exp-1", "es"),
    ])

    const report = await runExperienceEmbeddingBackfill({})

    expect(embedStub()).toHaveBeenCalledTimes(2)
    expect(embedStub().mock.calls[0]).toEqual(["locale-a"])
    expect(embedStub().mock.calls[1]).toEqual(["locale-b"])
    expect(report.totalTargets).toBe(2)
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(0)
    expect(report.outcomes).toHaveLength(2)
    expect(report.outcomes[0]).toMatchObject({
      status: "succeeded",
      target: {
        experienceLocaleId: "locale-a",
        experienceId: "exp-1",
        locale: "en",
      },
      dimensions: 1536,
      model: "text-embedding-3-small",
    })
    expect(report.outcomes[1]).toMatchObject({
      status: "succeeded",
      target: { experienceLocaleId: "locale-b", locale: "es" },
    })
  })

  it("isolates per-target failures and continues the loop (siblings still succeed)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("locale-a", "exp-1", "en"),
      row("locale-b", "exp-1", "es"),
      row("locale-c", "exp-2", "en"),
    ])
    embedStub()
      .mockImplementationOnce(async () => ({
        localeId: "locale-a",
        dimensions: 1536,
        model: "text-embedding-3-small",
      }))
      .mockImplementationOnce(async () => {
        throw new Error("provider 503")
      })
      .mockImplementationOnce(async () => ({
        localeId: "locale-c",
        dimensions: 1536,
        model: "text-embedding-3-small",
      }))

    const report = await runExperienceEmbeddingBackfill({})

    expect(embedStub()).toHaveBeenCalledTimes(3)
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.outcomes[0]).toMatchObject({
      status: "succeeded",
      target: { experienceLocaleId: "locale-a" },
    })
    expect(report.outcomes[1]).toMatchObject({
      status: "failed",
      target: { experienceLocaleId: "locale-b" },
      reason: "provider 503",
    })
    expect(report.outcomes[2]).toMatchObject({
      status: "succeeded",
      target: { experienceLocaleId: "locale-c" },
    })
  })

  it("isolates synchronous embedExperienceLocale throws (not just async rejections)", async () => {
    // Belt-and-suspenders for the per-target try/catch contract — a
    // helper that throws synchronously before its first `await` must
    // still classify as a failed outcome, not abort the loop.
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("locale-sync", "exp-sync", "en"),
      row("locale-async", "exp-sync", "es"),
    ])
    embedStub()
      .mockImplementationOnce(() => {
        throw new Error("synchronous boom")
      })
      .mockImplementationOnce(async () => ({
        localeId: "locale-async",
        dimensions: 1536,
        model: "text-embedding-3-small",
      }))

    const report = await runExperienceEmbeddingBackfill({})

    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.outcomes[0]).toMatchObject({
      status: "failed",
      reason: "synchronous boom",
    })
    expect(report.outcomes[1]).toMatchObject({ status: "succeeded" })
  })

  it("propagates the experienceIds + bcp47Locales filters into the report", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("locale-a", "exp-1", "en"),
    ])

    const report = await runExperienceEmbeddingBackfill({
      experienceIds: ["exp-1", "exp-2"],
      bcp47Locales: ["en", "es"],
    })

    expect(report.experienceIdFilter).toEqual(["exp-1", "exp-2"])
    expect(report.localeFilter).toEqual(["en", "es"])
    expect((prisma as unknown as PrismaStub).$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("composes the SQL clauses: force=false adds `embedding IS NULL`, force=true drops it", async () => {
    // T2 fix: inspect the Prisma.Sql fragments passed to $queryRaw so a
    // regression that hardcoded the embedding clause (or dropped it
    // unconditionally) fails loudly. Each clause is a `Prisma.Sql`
    // instance whose `.text` exposes the rendered SQL fragment with
    // `$N` placeholders for bound values.
    ;(prisma as unknown as PrismaStub).$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runExperienceEmbeddingBackfill({})
    await runExperienceEmbeddingBackfill({ force: true })

    const calls = (prisma as unknown as PrismaStub).$queryRaw.mock.calls
    expect(calls).toHaveLength(2)

    // Tagged-template call shape: calls[i][0] is the strings array,
    // calls[i][1..N] are the interpolated values. The first three
    // interpolated values are embeddingClause, experienceIdClause,
    // localeClause (in that order, per stepEnumerateTargets).
    const defaultEmbeddingClause = calls[0]![1] as Prisma.Sql
    const forceEmbeddingClause = calls[1]![1] as Prisma.Sql

    expect(defaultEmbeddingClause.text).toMatch(/embedding IS NULL/)
    // force: true uses Prisma.empty, which renders as an empty string.
    expect(forceEmbeddingClause.text).toBe("")
  })

  it("treats empty filter arrays as omitted (matches R1/R2 contract)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([])

    const report = await runExperienceEmbeddingBackfill({
      experienceIds: [],
      bcp47Locales: [],
    })

    expect(report.experienceIdFilter).toBeNull()
    expect(report.localeFilter).toBeNull()
  })

  it("exhaustive stepReport throws on unknown variant (compile-time guard validated at runtime)", () => {
    expect(() =>
      _internals.stepReport({
        totalTargets: 0,
        experienceIdFilter: null,
        localeFilter: null,
        force: false,
        // @ts-expect-error — deliberate unknown variant to exercise the guard
        outcomes: [{ status: "what-no" }],
      }),
    ).toThrow(/Unhandled ExperienceEmbeddingBackfillOutcome variant/)
  })
})
