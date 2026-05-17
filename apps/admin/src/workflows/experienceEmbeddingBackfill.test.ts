// Workflow-body tests for `runExperienceEmbeddingBackfill`.
//
// Asserts per-target dispatch + outcome aggregation + filter handling
// + per-target error isolation. The dispatch-site wiring of the
// resolver lives in
// `src/graphql/mutations/experience-embedding-backfill.test.ts` —
// `"use workflow"` is inert in tests, so the body executes directly
// here.

import { beforeEach, describe, expect, it, vi } from "vitest"

const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock("workflow/api", () => ({ start }))

vi.mock("@/db/client", () => {
  const mock = {
    $queryRaw: vi.fn(async () => [] as unknown[]),
  }
  return { prisma: mock, syncPrisma: mock }
})

const { prisma } = await import("@/db/client")
const { runExperienceEmbeddingBackfill, _internals } =
  await import("./experienceEmbeddingBackfill")
const { runExperienceEmbedding } = await import("./experienceEmbedding")

type PrismaStub = { $queryRaw: ReturnType<typeof vi.fn> }

function row(id: string, experienceId: string, locale: string) {
  return { id, experience_id: experienceId, locale }
}

function dispatchSuccess(dimensions = 1536, model = "text-embedding-3-small") {
  start.mockResolvedValueOnce({
    runId: `test-run-${Math.random().toString(36).slice(2, 10)}`,
    returnValue: Promise.resolve({
      localeId: "ignored-in-this-test",
      dimensions,
      model,
      updated: true,
    }),
  })
}

function dispatchFailure(message: string) {
  start.mockResolvedValueOnce({
    runId: `test-run-${Math.random().toString(36).slice(2, 10)}`,
    returnValue: Promise.reject(new Error(message)),
  })
}

describe("runExperienceEmbeddingBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
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
    expect(start).not.toHaveBeenCalled()
  })

  it("dispatches runExperienceEmbedding once per eligible target", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("locale-a", "exp-1", "en"),
      row("locale-b", "exp-1", "es"),
    ])
    dispatchSuccess()
    dispatchSuccess()

    const report = await runExperienceEmbeddingBackfill({})

    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[0]).toEqual([
      runExperienceEmbedding,
      [{ localeId: "locale-a" }],
    ])
    expect(start.mock.calls[1]).toEqual([
      runExperienceEmbedding,
      [{ localeId: "locale-b" }],
    ])
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
  })

  it("isolates per-target failures and continues the loop", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("locale-a", "exp-1", "en"),
      row("locale-b", "exp-1", "es"),
      row("locale-c", "exp-2", "en"),
    ])
    dispatchSuccess()
    dispatchFailure("provider 503")
    dispatchSuccess()

    const report = await runExperienceEmbeddingBackfill({})

    expect(start).toHaveBeenCalledTimes(3)
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.outcomes[1]).toMatchObject({
      status: "failed",
      target: { experienceLocaleId: "locale-b" },
      reason: "provider 503",
    })
  })

  it("propagates the experienceIds + bcp47Locales filters into the report", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([
      row("locale-a", "exp-1", "en"),
    ])
    dispatchSuccess()

    const report = await runExperienceEmbeddingBackfill({
      experienceIds: ["exp-1", "exp-2"],
      bcp47Locales: ["en", "es"],
    })

    expect(report.experienceIdFilter).toEqual(["exp-1", "exp-2"])
    expect(report.localeFilter).toEqual(["en", "es"])
    expect((prisma as unknown as PrismaStub).$queryRaw).toHaveBeenCalledTimes(1)
    // The actual SQL composition (Prisma.sql + Prisma.join clauses) is
    // covered by integration-style verification — a unit-test of the
    // rendered SQL string would couple to Prisma's internal template
    // wire format. The report-level assertion above proves the filter
    // values reached the workflow body; a real-DB smoke is the next
    // load-bearing check.
  })

  it("records force=true in the report (embedding IS NULL clause is dropped)", async () => {
    ;(prisma as unknown as PrismaStub).$queryRaw.mockResolvedValueOnce([])

    const report = await runExperienceEmbeddingBackfill({ force: true })

    expect(report.force).toBe(true)
    expect(report.totalTargets).toBe(0)
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
