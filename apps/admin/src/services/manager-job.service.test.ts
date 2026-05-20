import { beforeEach, describe, expect, it, vi } from "vitest"
import { MANAGER_BACKEND_PRINCIPAL, type Principal } from "@/auth/principal"
import { ManagerJobService } from "./manager-job.service"

function mockPrisma() {
  return {
    managerEnrichmentJob: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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
        options: { generateVoiceover: true },
        steps: [{ name: "download_video", status: "pending", retries: 0 }],
      },
    })

    expect(prisma.managerEnrichmentJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          muxAssetId: "asset-1",
          languages: ["fr"],
          status: "pending",
        }),
      }),
    )
    expect(result.id).toBe("job-1")
    expect(result.createdAt).toBe("2026-05-06T10:00:00.000Z")
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
        steps: [{ name: "download_video", status: "completed", retries: 0 }],
      },
    })

    expect(prisma.managerEnrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "running" }),
      }),
    )
    expect(result.status).toBe("running")
    expect(result.steps[0]?.status).toBe("completed")
  })
})
