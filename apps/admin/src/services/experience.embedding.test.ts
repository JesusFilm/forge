import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"

const runExperienceEmbedding = vi.fn()

vi.mock("@/workflows/experienceEmbedding", () => ({
  runExperienceEmbedding,
}))

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

  it("allows ADMIN to trigger any locale embedding workflow", async () => {
    const prisma = mockPrisma()
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-1",
      experience: { ownerId: "alice", archivedAt: null },
    })
    runExperienceEmbedding.mockResolvedValueOnce({
      localeId: "loc-1",
      updated: true,
    })

    const { ExperienceService } = await import("./experience.service")
    const service = new ExperienceService(prisma as never)
    const result = await service.triggerEmbedding({
      localeId: "loc-1",
      user: ADMIN,
    })

    expect(runExperienceEmbedding).toHaveBeenCalledWith({ localeId: "loc-1" })
    expect(result).toEqual({ localeId: "loc-1", updated: true })
  })

  it("allows an owning EDITOR to trigger the workflow", async () => {
    const prisma = mockPrisma()
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-2",
      experience: { ownerId: "alice", archivedAt: null },
    })
    runExperienceEmbedding.mockResolvedValueOnce({
      localeId: "loc-2",
      updated: true,
    })

    const { ExperienceService } = await import("./experience.service")
    const service = new ExperienceService(prisma as never)

    await service.triggerEmbedding({
      localeId: "loc-2",
      user: EDITOR_ALICE,
    })

    expect(runExperienceEmbedding).toHaveBeenCalledWith({ localeId: "loc-2" })
  })

  it("rejects a non-owning EDITOR", async () => {
    const prisma = mockPrisma()
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce({
      id: "loc-3",
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

    expect(runExperienceEmbedding).not.toHaveBeenCalled()
  })
})
