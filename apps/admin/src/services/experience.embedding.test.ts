import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const { start } = vi.hoisted(() => ({ start: vi.fn() }))

vi.mock("workflow/api", () => ({ start }))

import { runExperienceEmbedding } from "@/workflows/experienceEmbedding"

const dispatch = wrapStartSpy<{ localeId: string; updated: boolean }>(start)

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const EDITOR_ALICE: Principal = { id: "alice", role: "EDITOR" }
const EDITOR_BOB: Principal = { id: "bob", role: "EDITOR" }

function mockPrisma() {
  const experienceLocale = {
    findUniqueOrThrow: vi.fn(),
  }
  return {
    experienceLocale,
  }
}

describe("ExperienceService.triggerEmbedding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("allows ADMIN to dispatch any locale embedding workflow via start()", async () => {
    const prisma = mockPrisma()
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-1",
      status: "PUBLISHED",
      experience: { ownerId: "alice", archivedAt: null },
    })
    dispatch.mockReturnValue({ localeId: "loc-1", updated: true })

    const { ExperienceService } = await import("./experience.service")
    const service = new ExperienceService(prisma as never)
    const result = await service.triggerEmbedding({
      localeId: "loc-1",
      user: ADMIN,
    })

    dispatch.expectDispatched(runExperienceEmbedding, [{ localeId: "loc-1" }])
    expect(result).toEqual({ localeId: "loc-1", updated: true })
  })

  it("allows an owning EDITOR to dispatch the workflow", async () => {
    const prisma = mockPrisma()
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-2",
      status: "PUBLISHED",
      experience: { ownerId: "alice", archivedAt: null },
    })
    dispatch.mockReturnValue({ localeId: "loc-2", updated: true })

    const { ExperienceService } = await import("./experience.service")
    const service = new ExperienceService(prisma as never)

    await service.triggerEmbedding({
      localeId: "loc-2",
      user: EDITOR_ALICE,
    })

    dispatch.expectDispatched(runExperienceEmbedding, [{ localeId: "loc-2" }])
  })

  it("rejects a non-owning EDITOR before any dispatch", async () => {
    const prisma = mockPrisma()
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-3",
      status: "PUBLISHED",
      experience: { ownerId: "alice", archivedAt: null },
    })

    const { ExperienceService } = await import("./experience.service")
    const service = new ExperienceService(prisma as never)

    await expect(
      service.triggerEmbedding({
        localeId: "loc-3",
        user: EDITOR_BOB,
      }),
    ).rejects.toThrow("Forbidden")

    dispatch.expectNotDispatched()
  })

  it("rejects unpublished locales before dispatch", async () => {
    const prisma = mockPrisma()
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-draft",
      status: "DRAFT",
      experience: { ownerId: "alice", archivedAt: null },
    })

    const { ExperienceService } = await import("./experience.service")
    const service = new ExperienceService(prisma as never)

    await expect(
      service.triggerEmbedding({ localeId: "loc-draft", user: ADMIN }),
    ).rejects.toThrow("must be published")

    dispatch.expectNotDispatched()
  })

  it("rejects archived experiences before dispatch", async () => {
    const prisma = mockPrisma()
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-archived",
      status: "PUBLISHED",
      experience: {
        ownerId: "alice",
        archivedAt: new Date("2026-05-26T00:00:00.000Z"),
      },
    })

    const { ExperienceService } = await import("./experience.service")
    const service = new ExperienceService(prisma as never)

    await expect(
      service.triggerEmbedding({ localeId: "loc-archived", user: ADMIN }),
    ).rejects.toThrow("ExperienceLocale not found")

    dispatch.expectNotDispatched()
  })

  it("propagates workflow rejection from Run.returnValue", async () => {
    const prisma = mockPrisma()
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-4",
      status: "PUBLISHED",
      experience: { ownerId: "alice", archivedAt: null },
    })
    const boom = new Error("embedding provider timeout")
    dispatch.mockRejection(boom)

    const { ExperienceService } = await import("./experience.service")
    const service = new ExperienceService(prisma as never)

    await expect(
      service.triggerEmbedding({ localeId: "loc-4", user: ADMIN }),
    ).rejects.toBe(boom)
  })
})
