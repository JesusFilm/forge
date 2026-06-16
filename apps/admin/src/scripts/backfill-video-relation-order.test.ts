import { beforeEach, describe, expect, it, vi } from "vitest"

const { coreQueryMock } = vi.hoisted(() => ({
  coreQueryMock: vi.fn(),
}))

vi.mock("@/services/core-sync/core-client", () => ({
  coreQuery: coreQueryMock,
}))

import {
  databaseIdentityForUrl,
  parseArgs,
  runBackfill,
  runRelationOrderBackfillCli,
  selectAdminParentVideos,
  validateArgs,
} from "./backfill-video-relation-order"

function buildPrisma() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
  }
  return {
    tx,
    video: {
      findMany: vi.fn(),
    },
    videoRelation: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (trx: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    $disconnect: vi.fn(),
  }
}

function baseArgs(overrides = {}) {
  return {
    slug: "jesus",
    fullCatalog: false,
    execute: false,
    verbose: false,
    batchSize: 10,
    allowMissingTopology: false,
    ...overrides,
  }
}

function parent(overrides = {}) {
  return {
    id: "video-jesus",
    coreId: "1_jf-0-0",
    slug: "jesus",
    ...overrides,
  }
}

describe("backfill-video-relation-order args", () => {
  beforeEach(() => {
    coreQueryMock.mockReset()
  })

  it("defaults to dry-run and rejects broad runs without a guard", () => {
    const args = parseArgs([])

    expect(args.execute).toBe(false)
    expect(args.allowMissingTopology).toBe(false)
    expect(() => validateArgs(args)).toThrow(
      /Refusing broad relation-order backfill/,
    )
  })

  it("parses guarded execute options", () => {
    const args = parseArgs([
      "--full-catalog",
      "--execute",
      "--verbose",
      "--batch-size=5",
      "--allow-missing-topology",
      "--confirm-database=abc123",
      "--report-out=.tmp/report.json",
      "--transaction-timeout-ms=900000",
    ])

    expect(args).toMatchObject({
      fullCatalog: true,
      execute: true,
      verbose: true,
      batchSize: 5,
      allowMissingTopology: true,
      confirmDatabase: "abc123",
      reportOut: ".tmp/report.json",
      transactionTimeoutMs: 900000,
    })
    expect(() => validateArgs(args)).not.toThrow()
  })

  it("rejects malformed and nonpositive numeric flags", () => {
    for (const flag of ["limit", "batch-size", "transaction-timeout-ms"]) {
      expect(() => parseArgs([`--${flag}=10x`])).toThrow(
        `--${flag} must be a positive integer`,
      )
      expect(() => parseArgs([`--${flag}=0`])).toThrow(
        `--${flag} must be a positive integer`,
      )
    }
  })

  it("hashes a non-secret database identity and redacts credentials", () => {
    const identity = databaseIdentityForUrl(
      "postgresql://user:secret@db.example.test:5432/forge?connection_limit=5&api_key=secret-query",
    )

    expect(identity.hash).toHaveLength(16)
    expect(identity.redactedUrl).toContain("://***:***@db.example.test")
    expect(identity.redactedUrl).not.toContain("secret")
    expect(identity.redactedUrl).not.toContain("secret-query")
    expect(identity.redactedUrl).toContain("api_key=***")
  })
})

describe("selectAdminParentVideos", () => {
  beforeEach(() => {
    coreQueryMock.mockReset()
  })

  it("selects explicit targets even when they have no child relation rows", async () => {
    const prisma = buildPrisma()
    prisma.video.findMany.mockResolvedValueOnce([parent()])

    await selectAdminParentVideos(prisma as never, baseArgs())

    const query = prisma.video.findMany.mock.calls[0]?.[0]
    expect(query.where).toMatchObject({
      source: "CORE",
      deletedAt: null,
      slug: "jesus",
    })
    expect(query.where.children).toBeUndefined()
    expect(query.take).toBe(1)
  })

  it("selects explicit Core id targets without requiring child relation rows", async () => {
    const prisma = buildPrisma()
    prisma.video.findMany.mockResolvedValueOnce([
      parent({ coreId: "core-parent", slug: "collection" }),
    ])

    await selectAdminParentVideos(
      prisma as never,
      baseArgs({ slug: undefined, coreId: "core-parent" }),
    )

    const query = prisma.video.findMany.mock.calls[0]?.[0]
    expect(query.where).toMatchObject({
      source: "CORE",
      deletedAt: null,
      coreId: "core-parent",
    })
    expect(query.where.children).toBeUndefined()
  })

  it("limits broad mode to relation-bearing Core parents", async () => {
    const prisma = buildPrisma()
    prisma.video.findMany.mockResolvedValueOnce([])

    await selectAdminParentVideos(
      prisma as never,
      baseArgs({ slug: undefined, limit: 10 }),
    )

    const query = prisma.video.findMany.mock.calls[0]?.[0]
    expect(query.where).toMatchObject({
      source: "CORE",
      deletedAt: null,
      children: { some: {} },
    })
    expect(query.take).toBe(10)
  })
})

describe("runBackfill", () => {
  beforeEach(() => {
    coreQueryMock.mockReset()
  })

  it("dry-runs Core child order into planned relation updates and a rollback report", async () => {
    const prisma = buildPrisma()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    prisma.video.findMany
      .mockResolvedValueOnce([parent()])
      .mockResolvedValueOnce([
        { id: "child-a", coreId: "core-a", slug: "the-beginning" },
        { id: "child-b", coreId: "core-b", slug: "birth-of-jesus" },
        { id: "child-c", coreId: "core-c", slug: "childhood-of-jesus" },
      ])
    prisma.videoRelation.findMany.mockResolvedValueOnce([
      {
        id: "relation-a",
        parentId: "video-jesus",
        childId: "child-a",
        order: 3,
      },
      {
        id: "relation-b",
        parentId: "video-jesus",
        childId: "child-b",
        order: 2,
      },
      {
        id: "relation-c",
        parentId: "video-jesus",
        childId: "child-c",
        order: null,
      },
    ])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "1_jf-0-0",
            slug: "jesus",
            children: [
              { id: "core-a", slug: "the-beginning" },
              { id: "core-b", slug: "birth-of-jesus" },
              { id: "core-c", slug: "childhood-of-jesus" },
            ],
          },
        ],
      },
    })

    const summary = await runBackfill(prisma as never, baseArgs(), {
      runId: "run-1",
      reportPath: "/tmp/relation-order-report.json",
      databaseIdentityHash: "db-hash",
      writeReport,
    })

    expect(summary).toMatchObject({
      dryRun: true,
      selected: 1,
      fetchedCoreParents: 1,
      planned: 2,
      unchanged: 1,
      updated: 0,
      errors: 0,
      databaseIdentityHash: "db-hash",
      jesusFirstThree: {
        mismatch: false,
        actual: ["the-beginning", "birth-of-jesus", "childhood-of-jesus"],
      },
    })
    expect(coreQueryMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        offset: 0,
        limit: 1,
        where: { published: true, ids: ["1_jf-0-0"] },
      }),
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            relationId: "relation-a",
            oldOrder: 3,
            newOrder: 1,
            corePosition: 1,
          }),
          expect.objectContaining({
            relationId: "relation-c",
            oldOrder: null,
            newOrder: 3,
            corePosition: 3,
          }),
        ],
        rollbackSql: expect.stringContaining('SET "order" = 3'),
      }),
      "/tmp/relation-order-report.json",
    )
  })

  it("fails explicit target misses instead of reporting a no-op success", async () => {
    const prisma = buildPrisma()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    prisma.video.findMany.mockResolvedValueOnce([])

    await expect(
      runBackfill(prisma as never, baseArgs({ execute: true }), {
        runId: "run-empty-target",
        reportPath: "/tmp/relation-order-report.json",
        writeReport,
      }),
    ).rejects.toThrow(/did not match an Admin video/)

    expect(coreQueryMock).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          selected: 0,
          errors: 1,
        }),
      }),
      "/tmp/relation-order-report.json",
    )
  })

  it("fails execute when Core does not return the selected parent", async () => {
    const prisma = buildPrisma()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    prisma.video.findMany.mockResolvedValueOnce([parent()])
    prisma.videoRelation.findMany.mockResolvedValueOnce([])
    coreQueryMock.mockResolvedValueOnce({ data: { videos: [] } })

    await expect(
      runBackfill(
        prisma as never,
        baseArgs({ execute: true, confirmDatabase: "db-hash" }),
        {
          runId: "run-missing-core-parent",
          reportPath: "/tmp/relation-order-report.json",
          writeReport,
        },
      ),
    ).rejects.toThrow(/missing topology/)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        missingCoreParents: [
          expect.objectContaining({
            parentCoreId: "1_jf-0-0",
            parentSlug: "jesus",
          }),
        ],
        summary: expect.objectContaining({
          missingCoreParents: 1,
          errors: 1,
        }),
      }),
      "/tmp/relation-order-report.json",
    )
  })

  it("reports duplicate Core children and JESUS first-three mismatches", async () => {
    const prisma = buildPrisma()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    prisma.video.findMany
      .mockResolvedValueOnce([parent()])
      .mockResolvedValueOnce([
        { id: "child-x", coreId: "core-x", slug: "unexpected-first" },
      ])
    prisma.videoRelation.findMany.mockResolvedValueOnce([
      {
        id: "relation-x",
        parentId: "video-jesus",
        childId: "child-x",
        order: null,
        child: { coreId: "core-x", slug: "unexpected-first" },
      },
    ])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "1_jf-0-0",
            slug: "jesus",
            children: [
              { id: "core-x", slug: "unexpected-first" },
              { id: "core-x", slug: "unexpected-first" },
            ],
          },
        ],
      },
    })

    const summary = await runBackfill(prisma as never, baseArgs(), {
      runId: "run-duplicate-core-child",
      reportPath: "/tmp/relation-order-report.json",
      writeReport,
    })

    expect(summary).toMatchObject({
      duplicateCoreChildren: 1,
      errors: 1,
      jesusFirstThree: {
        mismatch: true,
        actual: ["unexpected-first", "unexpected-first"],
      },
    })
    expect(writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicateCoreChildren: [
          expect.objectContaining({
            childCoreId: "core-x",
            firstCorePosition: 1,
            duplicateCorePosition: 2,
          }),
        ],
        jesusFirstThree: expect.objectContaining({ mismatch: true }),
      }),
      "/tmp/relation-order-report.json",
    )
  })

  it("fails execute before mutation when Core topology is missing", async () => {
    const prisma = buildPrisma()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    prisma.video.findMany
      .mockResolvedValueOnce([parent()])
      .mockResolvedValueOnce([
        { id: "child-a", coreId: "core-a", slug: "the-beginning" },
        { id: "child-c", coreId: "core-c", slug: "childhood-of-jesus" },
      ])
    prisma.videoRelation.findMany.mockResolvedValueOnce([
      {
        id: "relation-a",
        parentId: "video-jesus",
        childId: "child-a",
        order: null,
      },
      {
        id: "relation-c",
        parentId: "video-jesus",
        childId: "child-c",
        order: null,
      },
    ])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "1_jf-0-0",
            slug: "jesus",
            children: [
              { id: "core-a", slug: "the-beginning" },
              { id: "core-b", slug: "birth-of-jesus" },
              { id: "core-c", slug: "childhood-of-jesus" },
            ],
          },
        ],
      },
    })

    await expect(
      runBackfill(
        prisma as never,
        baseArgs({ execute: true, confirmDatabase: "db-hash" }),
        {
          runId: "run-2",
          reportPath: "/tmp/relation-order-report.json",
          writeReport,
        },
      ),
    ).rejects.toThrow(/missing topology/)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        missingAdminChildren: [
          expect.objectContaining({
            childCoreId: "core-b",
            corePosition: 2,
          }),
        ],
        changes: [
          expect.objectContaining({ childCoreId: "core-a", newOrder: 1 }),
          expect.objectContaining({ childCoreId: "core-c", newOrder: 3 }),
        ],
      }),
      "/tmp/relation-order-report.json",
    )
  })

  it("fails execute when Admin has a relation that Core no longer lists", async () => {
    const prisma = buildPrisma()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    prisma.video.findMany
      .mockResolvedValueOnce([parent()])
      .mockResolvedValueOnce([
        { id: "child-a", coreId: "core-a", slug: "the-beginning" },
      ])
    prisma.videoRelation.findMany.mockResolvedValueOnce([
      {
        id: "relation-a",
        parentId: "video-jesus",
        childId: "child-a",
        order: null,
        child: { coreId: "core-a", slug: "the-beginning" },
      },
      {
        id: "relation-extra",
        parentId: "video-jesus",
        childId: "child-extra",
        order: 99,
        child: { coreId: "core-extra", slug: "stale-child" },
      },
    ])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "1_jf-0-0",
            slug: "jesus",
            children: [{ id: "core-a", slug: "the-beginning" }],
          },
        ],
      },
    })

    await expect(
      runBackfill(
        prisma as never,
        baseArgs({ execute: true, confirmDatabase: "db-hash" }),
        {
          runId: "run-extra-relation",
          reportPath: "/tmp/relation-order-report.json",
          writeReport,
        },
      ),
    ).rejects.toThrow(/missing topology/)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        extraAdminRelations: [
          expect.objectContaining({
            relationId: "relation-extra",
            childCoreId: "core-extra",
            oldOrder: 99,
          }),
        ],
        summary: expect.objectContaining({
          extraAdminRelation: 1,
          errors: 1,
        }),
      }),
      "/tmp/relation-order-report.json",
    )
  })

  it("fails execute before mutation when an Admin child exists without a relation row", async () => {
    const prisma = buildPrisma()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    prisma.video.findMany
      .mockResolvedValueOnce([parent()])
      .mockResolvedValueOnce([
        { id: "child-a", coreId: "core-a", slug: "the-beginning" },
        { id: "child-b", coreId: "core-b", slug: "birth-of-jesus" },
        { id: "child-c", coreId: "core-c", slug: "childhood-of-jesus" },
      ])
    prisma.videoRelation.findMany.mockResolvedValueOnce([
      {
        id: "relation-a",
        parentId: "video-jesus",
        childId: "child-a",
        order: null,
      },
      {
        id: "relation-c",
        parentId: "video-jesus",
        childId: "child-c",
        order: null,
      },
    ])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "1_jf-0-0",
            slug: "jesus",
            children: [
              { id: "core-a", slug: "the-beginning" },
              { id: "core-b", slug: "birth-of-jesus" },
              { id: "core-c", slug: "childhood-of-jesus" },
            ],
          },
        ],
      },
    })

    await expect(
      runBackfill(
        prisma as never,
        baseArgs({ execute: true, confirmDatabase: "db-hash" }),
        {
          runId: "run-missing-relation",
          reportPath: "/tmp/relation-order-report.json",
          writeReport,
        },
      ),
    ).rejects.toThrow(/missing topology/)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(writeReport).toHaveBeenCalledWith(
      expect.objectContaining({
        missingRelations: [
          expect.objectContaining({
            childCoreId: "core-b",
            childId: "child-b",
            corePosition: 2,
          }),
        ],
        changes: [
          expect.objectContaining({ childCoreId: "core-a", newOrder: 1 }),
          expect.objectContaining({ childCoreId: "core-c", newOrder: 3 }),
        ],
      }),
      "/tmp/relation-order-report.json",
    )
  })

  it("executes present rows when missing relation topology is explicitly allowed", async () => {
    const prisma = buildPrisma()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    prisma.tx.$executeRaw.mockResolvedValueOnce(2)
    prisma.video.findMany
      .mockResolvedValueOnce([parent()])
      .mockResolvedValueOnce([
        { id: "child-a", coreId: "core-a", slug: "the-beginning" },
        { id: "child-b", coreId: "core-b", slug: "birth-of-jesus" },
        { id: "child-c", coreId: "core-c", slug: "childhood-of-jesus" },
      ])
    prisma.videoRelation.findMany.mockResolvedValueOnce([
      {
        id: "relation-a",
        parentId: "video-jesus",
        childId: "child-a",
        order: 9,
      },
      {
        id: "relation-c",
        parentId: "video-jesus",
        childId: "child-c",
        order: null,
      },
    ])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "1_jf-0-0",
            slug: "jesus",
            children: [
              { id: "core-a", slug: "the-beginning" },
              { id: "core-b", slug: "birth-of-jesus" },
              { id: "core-c", slug: "childhood-of-jesus" },
            ],
          },
        ],
      },
    })

    const summary = await runBackfill(
      prisma as never,
      baseArgs({
        execute: true,
        allowMissingTopology: true,
        confirmDatabase: "db-hash",
      }),
      {
        runId: "run-3",
        reportPath: "/tmp/relation-order-report.json",
        databaseIdentityHash: "db-hash",
        writeReport,
      },
    )

    expect(summary).toMatchObject({
      dryRun: false,
      planned: 2,
      updated: 2,
      missingRelation: 1,
      errors: 1,
    })
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(prisma.tx.$executeRaw).toHaveBeenCalledOnce()
    expect(writeReport).toHaveBeenCalledTimes(2)
    expect(writeReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: expect.not.objectContaining({
          confirmDatabase: expect.anything(),
        }),
        databaseIdentityHash: "db-hash",
        firstCoreChildSlugsByParent: [
          expect.objectContaining({
            firstCoreChildSlugs: [
              "the-beginning",
              "birth-of-jesus",
              "childhood-of-jesus",
            ],
          }),
        ],
        changes: [
          expect.objectContaining({
            relationId: "relation-a",
            parentId: "video-jesus",
            childId: "child-a",
            oldOrder: 9,
            newOrder: 1,
            corePosition: 1,
          }),
          expect.objectContaining({
            relationId: "relation-c",
            parentId: "video-jesus",
            childId: "child-c",
            oldOrder: null,
            newOrder: 3,
            corePosition: 3,
          }),
        ],
        missingRelations: [
          expect.objectContaining({
            childCoreId: "core-b",
            childId: "child-b",
            corePosition: 2,
          }),
        ],
        rollbackSql: expect.stringContaining('SET "order" = 9'),
        summary: expect.objectContaining({ updated: 2 }),
      }),
      "/tmp/relation-order-report.json",
    )
    const finalReport = writeReport.mock.calls.at(-1)?.[0]
    expect(finalReport.rollbackSql).toContain('SET "order" = NULL')
  })

  it("retries a Prisma P2024 batch transaction without double-counting", async () => {
    const prisma = buildPrisma()
    const onPoolRetry = vi.fn()
    const sleep = vi.fn().mockResolvedValue(undefined)
    prisma.$transaction
      .mockRejectedValueOnce(
        Object.assign(new Error("pool timeout"), { code: "P2024" }),
      )
      .mockImplementationOnce(
        async (fn: (trx: typeof prisma.tx) => Promise<unknown>) =>
          fn(prisma.tx),
      )
    prisma.tx.$executeRaw.mockResolvedValueOnce(1)
    prisma.video.findMany
      .mockResolvedValueOnce([parent()])
      .mockResolvedValueOnce([
        { id: "child-a", coreId: "core-a", slug: "the-beginning" },
      ])
    prisma.videoRelation.findMany.mockResolvedValueOnce([
      {
        id: "relation-a",
        parentId: "video-jesus",
        childId: "child-a",
        order: null,
      },
    ])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "1_jf-0-0",
            slug: "jesus",
            children: [{ id: "core-a", slug: "the-beginning" }],
          },
        ],
      },
    })

    const summary = await runBackfill(
      prisma as never,
      baseArgs({ execute: true, confirmDatabase: "db-hash" }),
      {
        runId: "run-4",
        reportPath: "/tmp/relation-order-report.json",
        writeReport: vi.fn().mockResolvedValue(undefined),
        onPoolRetry,
        sleep,
      },
    )

    expect(summary.updated).toBe(1)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(onPoolRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, nextAttempt: 2 }),
    )
  })

  it("fails execute when a planned update batch touches fewer rows than planned", async () => {
    const prisma = buildPrisma()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    prisma.tx.$executeRaw.mockResolvedValueOnce(0)
    prisma.video.findMany
      .mockResolvedValueOnce([parent()])
      .mockResolvedValueOnce([
        { id: "child-a", coreId: "core-a", slug: "the-beginning" },
      ])
    prisma.videoRelation.findMany.mockResolvedValueOnce([
      {
        id: "relation-a",
        parentId: "video-jesus",
        childId: "child-a",
        order: null,
      },
    ])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "1_jf-0-0",
            slug: "jesus",
            children: [{ id: "core-a", slug: "the-beginning" }],
          },
        ],
      },
    })

    await expect(
      runBackfill(
        prisma as never,
        baseArgs({ execute: true, confirmDatabase: "db-hash" }),
        {
          runId: "run-update-mismatch",
          reportPath: "/tmp/relation-order-report.json",
          writeReport,
        },
      ),
    ).rejects.toThrow(/affected fewer rows than planned/)

    expect(writeReport).toHaveBeenCalledTimes(1)
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
})

describe("runRelationOrderBackfillCli", () => {
  beforeEach(() => {
    coreQueryMock.mockReset()
  })

  it("refuses execute without a matching database confirmation before opening Prisma", async () => {
    const logger = vi.fn()
    const prismaFactory = vi.fn()

    await expect(
      runRelationOrderBackfillCli({
        argv: ["--slug=jesus", "--execute"],
        env: {
          NODE_ENV: "test",
          DATABASE_URL:
            "postgresql://user:secret@db.example.test:5432/forge?connection_limit=5",
        },
        logger,
        prismaFactory,
      }),
    ).rejects.toThrow(/requires --confirm-database/)

    expect(prismaFactory).not.toHaveBeenCalled()
    expect(coreQueryMock).not.toHaveBeenCalled()
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "video-relation-order.backfill.fatal",
      }),
    )
  })

  it("runs a locked dry-run and releases the sync lock on success", async () => {
    const prisma = buildPrisma()
    const logger = vi.fn()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    const intervalHandle = { unref: vi.fn() }
    const setIntervalFn = vi.fn(() => intervalHandle)
    const clearIntervalFn = vi.fn()
    const lockApi = {
      acquireSyncLock: vi.fn().mockResolvedValue(true),
      refreshSyncLock: vi.fn().mockResolvedValue(true),
      releaseSyncLock: vi.fn().mockResolvedValue(true),
    }
    prisma.video.findMany.mockResolvedValueOnce([parent()])
    prisma.videoRelation.findMany.mockResolvedValueOnce([])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [{ id: "1_jf-0-0", slug: "jesus", children: [] }],
      },
    })

    const summary = await runRelationOrderBackfillCli({
      argv: ["--slug=jesus"],
      env: {
        NODE_ENV: "test",
        DATABASE_URL:
          "postgresql://user:secret@db.example.test:5432/forge?connection_limit=5",
      },
      logger,
      prismaFactory: () => prisma as never,
      lockApi,
      setIntervalFn: setIntervalFn as never,
      clearIntervalFn: clearIntervalFn as never,
      now: () => 123,
      writeReport,
    })

    expect(summary).toMatchObject({ dryRun: true, selected: 1 })
    expect(lockApi.acquireSyncLock).toHaveBeenCalledOnce()
    expect(lockApi.refreshSyncLock).toHaveBeenCalled()
    expect(lockApi.releaseSyncLock).toHaveBeenCalledOnce()
    expect(clearIntervalFn).toHaveBeenCalledWith(intervalHandle)
    expect(prisma.$disconnect).toHaveBeenCalledOnce()
    expect(writeReport).toHaveBeenCalledOnce()
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "video-relation-order.backfill.complete",
      }),
    )
  })

  it("aborts before mutation and releases resources when the sync lock is lost", async () => {
    const databaseUrl =
      "postgresql://user:secret@db.example.test:5432/forge?connection_limit=5"
    const identity = databaseIdentityForUrl(databaseUrl)
    const prisma = buildPrisma()
    const logger = vi.fn()
    const writeReport = vi.fn().mockResolvedValue(undefined)
    const intervalHandle = { unref: vi.fn() }
    const setIntervalFn = vi.fn(() => intervalHandle)
    const clearIntervalFn = vi.fn()
    const lockApi = {
      acquireSyncLock: vi.fn().mockResolvedValue(true),
      refreshSyncLock: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      releaseSyncLock: vi.fn().mockResolvedValue(true),
    }
    prisma.video.findMany
      .mockResolvedValueOnce([parent()])
      .mockResolvedValueOnce([
        { id: "child-a", coreId: "core-a", slug: "the-beginning" },
      ])
    prisma.videoRelation.findMany.mockResolvedValueOnce([
      {
        id: "relation-a",
        parentId: "video-jesus",
        childId: "child-a",
        order: null,
      },
    ])
    coreQueryMock.mockResolvedValueOnce({
      data: {
        videos: [
          {
            id: "1_jf-0-0",
            slug: "jesus",
            children: [{ id: "core-a", slug: "the-beginning" }],
          },
        ],
      },
    })

    await expect(
      runRelationOrderBackfillCli({
        argv: [
          "--slug=jesus",
          "--execute",
          `--confirm-database=${identity.hash}`,
        ],
        env: {
          NODE_ENV: "test",
          DATABASE_URL: databaseUrl,
        },
        logger,
        prismaFactory: () => prisma as never,
        lockApi,
        setIntervalFn: setIntervalFn as never,
        clearIntervalFn: clearIntervalFn as never,
        now: () => 123,
        writeReport,
      }),
    ).rejects.toThrow(/Core sync lock lost/)

    expect(writeReport).toHaveBeenCalledOnce()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(lockApi.releaseSyncLock).toHaveBeenCalledOnce()
    expect(clearIntervalFn).toHaveBeenCalledWith(intervalHandle)
    expect(prisma.$disconnect).toHaveBeenCalledOnce()
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "video-relation-order.backfill.fatal",
        error: expect.stringContaining("Core sync lock lost"),
      }),
    )
  })

  it("refuses to start when the Core sync lock is already held", async () => {
    const prisma = buildPrisma()
    const logger = vi.fn()
    const lockApi = {
      acquireSyncLock: vi.fn().mockResolvedValue(false),
      refreshSyncLock: vi.fn(),
      releaseSyncLock: vi.fn().mockResolvedValue(false),
    }

    await expect(
      runRelationOrderBackfillCli({
        argv: ["--slug=jesus"],
        env: {
          NODE_ENV: "test",
          DATABASE_URL:
            "postgresql://user:secret@db.example.test:5432/forge?connection_limit=5",
        },
        logger,
        prismaFactory: () => prisma as never,
        lockApi,
      }),
    ).rejects.toThrow(/Core sync lock is held/)

    expect(prisma.video.findMany).not.toHaveBeenCalled()
    expect(lockApi.releaseSyncLock).not.toHaveBeenCalled()
    expect(prisma.$disconnect).toHaveBeenCalledOnce()
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "video-relation-order.backfill.fatal",
      }),
    )
  })
})
