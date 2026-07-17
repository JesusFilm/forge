import { describe, expect, it, vi } from "vitest"
import {
  MatchJobStatus as PrismaMatchJobStatus,
  type MatchJob,
  type PrismaClient,
} from "../generated/prisma/index.js"
import { JOB_EXPIRED_ERROR_CODE } from "../services/match-job.service.js"
import { PrismaMatchJobRepository } from "./match-job.repository.js"

describe("PrismaMatchJobRepository cleaner operations", () => {
  it("expires queued jobs in a bounded batch and returns only transitioned rows", async () => {
    const cutoff = new Date("2026-06-08T00:30:00.000Z")
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: "job-a" }, { id: "job-b" }])
      .mockResolvedValueOnce([
        prismaJob({
          id: "job-a",
          status: PrismaMatchJobStatus.EXPIRED,
          safeErrorCode: JOB_EXPIRED_ERROR_CODE,
        }),
        prismaJob({
          id: "job-b",
          status: PrismaMatchJobStatus.EXPIRED,
          safeErrorCode: JOB_EXPIRED_ERROR_CODE,
        }),
      ])
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const repository = createRepository({
      $transaction: async (
        callback: (tx: unknown) => Promise<unknown>,
      ): Promise<unknown> =>
        callback({
          matchJob: {
            findMany,
            updateMany,
          },
        }),
    })

    const result = await repository.expireQueuedBefore(cutoff, 2)

    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: PrismaMatchJobStatus.QUEUED,
          queuedAt: { lte: cutoff },
        },
        orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
        take: 2,
        select: { id: true },
      }),
    )
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["job-a", "job-b"] },
        status: PrismaMatchJobStatus.QUEUED,
        queuedAt: { lte: cutoff },
      },
      data: {
        status: PrismaMatchJobStatus.EXPIRED,
        safeErrorCode: JOB_EXPIRED_ERROR_CODE,
      },
    })
    expect(result).toMatchObject({
      jobs: [
        { id: "job-a", status: "expired" },
        { id: "job-b", status: "expired" },
      ],
      scannedCount: 2,
    })
  })

  it("uses cursor pagination when retrying expired upload cleanup", async () => {
    const cursor = {
      queuedAt: new Date("2026-06-08T00:00:00.000Z"),
      id: "job-a",
    }
    const findMany = vi.fn().mockResolvedValue([
      prismaJob({
        id: "job-b",
        status: PrismaMatchJobStatus.EXPIRED,
        queuedAt: new Date("2026-06-08T00:01:00.000Z"),
      }),
    ])
    const repository = createRepository({
      matchJob: {
        findMany,
      },
    })

    const jobs = await repository.listExpiredWithUploads(50, cursor)

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: PrismaMatchJobStatus.EXPIRED,
        AND: [
          {
            OR: [
              { queuedAt: { gt: cursor.queuedAt } },
              {
                queuedAt: cursor.queuedAt,
                id: { gt: cursor.id },
              },
            ],
          },
        ],
        OR: [
          { uploadStorageKey: { not: null } },
          { uploadContentType: { not: null } },
          { uploadByteLength: { not: null } },
        ],
      },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
      take: 50,
    })
    expect(jobs).toMatchObject([{ id: "job-b", status: "expired" }])
  })

  it("clears upload fields only after a row is expired", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const repository = createRepository({
      matchJob: {
        updateMany,
      },
    })

    await repository.clearUploadFields("job-expired")

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-expired",
        status: PrismaMatchJobStatus.EXPIRED,
      },
      data: {
        uploadStorageKey: null,
        uploadContentType: null,
        uploadByteLength: null,
      },
    })
  })

  it("records and releases cleaner leases by owner token", async () => {
    const now = new Date("2026-06-08T00:00:00.000Z")
    const lockedUntil = new Date("2026-06-08T00:30:00.000Z")
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    const create = vi.fn().mockResolvedValue({})
    const repository = createRepository({
      matchJobCleanerLease: {
        updateMany,
        create,
      },
    })

    await expect(
      repository.tryAcquireCleanerLease(now, lockedUntil, "owner-a"),
    ).resolves.toBe(true)
    await repository.releaseCleanerLease(now, "owner-a")

    expect(create).toHaveBeenCalledWith({
      data: {
        name: "match_job_cleaner",
        lockedUntil,
        ownerToken: "owner-a",
      },
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        name: "match_job_cleaner",
        ownerToken: "owner-a",
        lockedUntil: { gt: now },
      },
      data: { lockedUntil: now },
    })
  })
})

function createRepository(db: unknown): PrismaMatchJobRepository {
  return new PrismaMatchJobRepository(db as PrismaClient)
}

function prismaJob({
  id,
  ...overrides
}: Partial<MatchJob> & { id: string }): MatchJob {
  const timestamp = new Date("2026-06-08T00:00:00.000Z")

  return {
    id,
    status: PrismaMatchJobStatus.QUEUED,
    uploadStorageKey: "upload-key",
    uploadContentType: "video/mp4",
    uploadByteLength: BigInt(10),
    inputDurationMilliseconds: null,
    resultLimit: 3,
    safeErrorCode: null,
    queuedAt: timestamp,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    retentionExpiresAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}
