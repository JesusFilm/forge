import { beforeEach, describe, expect, it, vi } from "vitest"
import { MANAGER_BACKEND_PRINCIPAL, type Principal } from "@/auth/principal"
import { ManagerJobService } from "./manager-job.service"

function mockPrisma() {
  return {
    managerEnrichmentJob: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    video: {
      findMany: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const PUBLIC_USER: Principal | null = null

const JOB_ROW = {
  id: "job-1",
  muxAssetId: "asset-1",
  muxPlaybackId: "playback-1",
  videoDocumentId: "video-1",
  languages: ["fr"],
  sourceLanguageId: "lang-en",
  sourceLanguageCode: "en",
  sourceSelectionReason: "primary_language",
  primaryRequestedTargetLanguageCode: "fr",
  resolvedTargetLanguageCodes: ["fr"],
  sourceCollectionTitle: "Collection",
  sourceMediaTitle: "Video",
  requestedLanguageAbbreviations: ["fra"],
  options: { generateVoiceover: true },
  status: "pending",
  currentStep: "download_video",
  retries: 0,
  artifacts: {},
  steps: [
    {
      name: "download_video",
      status: "pending",
      retries: 0,
      details: {},
    },
  ],
  errors: [],
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2026-05-06T10:00:00.000Z"),
  updatedAt: new Date("2026-05-06T10:00:00.000Z"),
}

describe("ManagerJobService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: ManagerJobService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new ManagerJobService(prisma)
  })

  it("rejects unauthenticated job reads", async () => {
    await expect(service.list({ user: PUBLIC_USER })).rejects.toThrow(
      "Forbidden",
    )
  })

  it("creates a Manager-shaped enrichment job record", async () => {
    prisma.managerEnrichmentJob.create.mockResolvedValueOnce(JOB_ROW)

    const result = await service.create({
      user: MANAGER_BACKEND_PRINCIPAL,
      input: {
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        videoDocumentId: "video-1",
        languages: ["fr"],
        sourceLanguageId: "529",
        sourceLanguageCode: "en",
        sourceSelectionReason: "requested",
        primaryRequestedTargetLanguageCode: "fr",
        resolvedTargetLanguageCodes: ["fr"],
        sourceCollectionTitle: "Collection",
        sourceMediaTitle: "Video",
        requestedLanguageAbbreviations: ["fra"],
        options: { generateVoiceover: true },
        artifacts: {
          materialization: {
            kind: "metadata",
            data: { sourceLanguageCode: "en" },
          },
        },
        errors: [{ step: "download_video", message: "retry", at: "now" }],
        steps: [{ name: "download_video", status: "pending", retries: 0 }],
      },
    })

    expect(prisma.managerEnrichmentJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          muxAssetId: "asset-1",
          languages: ["fr"],
          sourceLanguageCode: "en",
          artifacts: {
            materialization: {
              kind: "metadata",
              data: { sourceLanguageCode: "en" },
            },
          },
          errors: [{ step: "download_video", message: "retry", at: "now" }],
          status: "pending",
        }),
      }),
    )
    expect(result.id).toBe("job-1")
    expect(result.createdAt).toBe("2026-05-06T10:00:00.000Z")
    expect(result.sourceLanguageCode).toBe("en")
  })

  it("lists jobs with caller pagination without imposing an Admin-side 100 row cap", async () => {
    prisma.managerEnrichmentJob.findMany.mockResolvedValueOnce([JOB_ROW])

    await service.list({
      user: MANAGER_BACKEND_PRINCIPAL,
      limit: 250,
      offset: 125,
    })

    expect(prisma.managerEnrichmentJob.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 250,
      skip: 125,
    })
  })

  it("hydrates missing source titles from the related video when listing jobs", async () => {
    prisma.managerEnrichmentJob.findMany.mockResolvedValueOnce([
      {
        ...JOB_ROW,
        sourceCollectionTitle: null,
        sourceMediaTitle: null,
      },
    ])
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-1",
        locales: [
          { locale: "fr", title: "Titre français" },
          { locale: "en", title: "Recovered video title" },
        ],
        parents: [
          {
            parent: {
              locales: [{ locale: "en", title: "Recovered collection" }],
            },
          },
        ],
      },
    ])

    const result = await service.list({
      user: MANAGER_BACKEND_PRINCIPAL,
      limit: 50,
      offset: 0,
    })

    expect(prisma.video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["video-1"] }, deletedAt: null },
      }),
    )
    expect(result[0]).toMatchObject({
      sourceCollectionTitle: "Recovered collection",
      sourceMediaTitle: "Recovered video title",
    })
  })

  it("counts jobs independently from the page size", async () => {
    prisma.managerEnrichmentJob.count.mockResolvedValueOnce(347)

    await expect(
      service.count({ user: MANAGER_BACKEND_PRINCIPAL }),
    ).resolves.toBe(347)
  })

  it("updates status and step state idempotently", async () => {
    prisma.managerEnrichmentJob.update.mockResolvedValueOnce({
      ...JOB_ROW,
      status: "running",
      steps: [{ name: "download_video", status: "completed", retries: 0 }],
    })

    const result = await service.update({
      user: MANAGER_BACKEND_PRINCIPAL,
      id: "job-1",
      input: {
        status: "running",
        sourceLanguageCode: "en",
        steps: [{ name: "download_video", status: "completed", retries: 0 }],
      },
    })

    expect(prisma.managerEnrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({
          status: "running",
          sourceLanguageCode: "en",
        }),
      }),
    )
    expect(result.status).toBe("running")
    expect(result.steps[0]?.status).toBe("completed")
  })
})
