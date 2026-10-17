import { PrismaClient } from "@prisma/client"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { env } from "@/config/env"
import { acquireSyncLock } from "./core-sync/lock"
import {
  executeNextCoreSyncPhase,
  observeCoreSyncPhase,
} from "./core-sync/phase-execution"
import { requestWatchCatalogPublication } from "./watch-catalog-publication"
import { syncVideos } from "./core-sync/phases/sync-videos"
import type { CoreSyncJobStart } from "./core-sync/job"

const { runPhase, coreQuery } = vi.hoisted(() => ({
  runPhase: vi.fn(),
  coreQuery: vi.fn(),
}))
vi.mock("./core-sync/job", () => ({ runCoreSyncPhaseJob: runPhase }))
vi.mock("./core-sync/core-client", () => ({ coreQuery }))

// An explicit disposable database name is required: never clean a shared DB.
const url = new URL(env.DATABASE_URL)
const enabled =
  ["127.0.0.1", "localhost"].includes(url.hostname) &&
  url.pathname === "/core_watch_delivery_test"
describe.runIf(enabled)("Core Watch durable delivery on Postgres", () => {
  let prisma: PrismaClient
  const result = {
    phase: "videos",
    created: 1,
    updated: 0,
    softDeleted: 0,
    errors: 0,
    durationMs: 600_000,
  }
  const start: Exclude<CoreSyncJobStart, { skipped: true }> = {
    skipped: false,
    run: {
      runId: "delivery-test",
      incremental: false,
      phasesToRun: ["videos"],
      startedAtMs: Date.now(),
    },
    scope: ["videos"],
    incremental: false,
    trigger: "manual",
  }
  beforeAll(() => {
    prisma = new PrismaClient({
      datasources: { db: { url: env.DATABASE_URL } },
    })
  })
  afterAll(async () => {
    await prisma?.$disconnect()
  })
  beforeEach(async () => {
    vi.resetAllMocks()
    await prisma.videoRelation.deleteMany()
    await prisma.video.deleteMany({
      where: { coreId: { startsWith: "delivery-" } },
    })
    await prisma.watchCatalogPublication.deleteMany()
    await prisma.coreSyncPhaseExecution.deleteMany()
    await prisma.syncState.deleteMany()
    await prisma.syncLock.deleteMany()
    await acquireSyncLock(prisma, start.run.runId)
    runPhase.mockResolvedValue(result)
  })

  it("coalesces simultaneous content requests without losing increments", async () => {
    await Promise.all(
      Array.from({ length: 12 }, () => requestWatchCatalogPublication(prisma)),
    )
    expect(
      await prisma.watchCatalogPublication.findUnique({
        where: { id: "core" },
      }),
    ).toMatchObject({ requestedVersion: 12, searchVersion: 0, webVersion: 0 })
  })

  it("enqueues once and replays a completed long phase without another writer", async () => {
    await Promise.all([
      observeCoreSyncPhase(prisma, start, "videos"),
      observeCoreSyncPhase(prisma, start, "videos"),
    ])
    expect(await prisma.coreSyncPhaseExecution.count()).toBe(1)
    expect(await executeNextCoreSyncPhase(prisma)).toBe(true)
    expect(await observeCoreSyncPhase(prisma, start, "videos")).toEqual(result)
    expect(await executeNextCoreSyncPhase(prisma)).toBe(false)
    expect(runPhase).toHaveBeenCalledTimes(1)
  })

  it("excludes concurrent workers with a real Postgres session lock", async () => {
    let release!: () => void
    let entered!: () => void
    const running = new Promise<void>((resolve) => {
      entered = resolve
    })
    runPhase.mockImplementationOnce(async () => {
      entered()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return result
    })
    await observeCoreSyncPhase(prisma, start, "videos")
    const first = executeNextCoreSyncPhase(prisma)
    await running
    try {
      expect(await executeNextCoreSyncPhase(prisma)).toBe(false)
    } finally {
      release()
    }
    await first
    expect(runPhase).toHaveBeenCalledTimes(1)
  })

  it("recovers a RUNNING phase after its owner process disappeared", async () => {
    await observeCoreSyncPhase(prisma, start, "videos")
    await prisma.coreSyncPhaseExecution.updateMany({
      data: { state: "RUNNING", claimToken: "dead-owner", attempts: 1 },
    })
    await executeNextCoreSyncPhase(prisma)
    expect(await observeCoreSyncPhase(prisma, start, "videos")).toEqual(result)
    expect(await prisma.coreSyncPhaseExecution.findFirst()).toMatchObject({
      attempts: 2,
      state: "COMPLETE",
    })
  })

  it("marks crashed phases failed and blocks publication without advancing a watermark", async () => {
    runPhase.mockRejectedValueOnce(
      new Error("interrupted after a committed page"),
    )
    await observeCoreSyncPhase(prisma, start, "videos")
    await executeNextCoreSyncPhase(prisma)
    await expect(observeCoreSyncPhase(prisma, start, "videos")).rejects.toThrow(
      "interrupted",
    )
    expect(
      await prisma.syncState.findUnique({ where: { phase: "videos" } }),
    ).toMatchObject({ lastSyncedAt: new Date(0), stats: { errors: 1 } })
  })

  it("links a new parent to children created on a later Core page on the first import", async () => {
    const video = (id: string, children: string[] = []) => ({
      id,
      slug: id,
      label: "episode",
      publishedAt: "2026-09-29T00:00:00Z",
      primaryLanguageId: null,
      source: null,
      origin: null,
      title: [],
      description: [],
      snippet: [],
      studyQuestions: [],
      imageAlt: [],
      bibleCitations: [],
      keywords: [],
      children: children.map((id) => ({ id })),
      locked: false,
      noIndex: false,
      updatedAt: "2026-09-29T00:00:00Z",
    })
    const parent = video("delivery-parent", [
      "delivery-child-b",
      "delivery-child-a",
    ])
    coreQuery
      .mockResolvedValueOnce({ data: { bibleBooks: [] } })
      .mockResolvedValueOnce({
        data: {
          videos: [
            parent,
            ...Array.from({ length: 24 }, (_, i) =>
              video(`delivery-filler-${i}`),
            ),
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          videos: [video("delivery-child-a"), video("delivery-child-b")],
        },
      })
    const stats = await syncVideos({
      prisma,
      progress: { setTotal() {}, increment() {} },
    })
    expect(stats.errors).toBe(0)
    expect(
      await prisma.videoRelation.findMany({
        where: { parent: { coreId: parent.id } },
        orderBy: { order: "asc" },
        select: { order: true, child: { select: { coreId: true } } },
      }),
    ).toEqual([
      { order: 1, child: { coreId: "delivery-child-b" } },
      { order: 2, child: { coreId: "delivery-child-a" } },
    ])
  })
})
