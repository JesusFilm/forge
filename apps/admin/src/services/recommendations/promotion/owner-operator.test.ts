import type { PrismaClient, RecommendationOwnerRelease } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RecommendationOwnerReleaseOperator } from "./owner-operator"
import {
  prepareOwnerReleaseBinding,
  readActiveOwnerRelease,
} from "./owner-authority"
import { OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID } from "./manifest"

vi.mock("./owner-authority", () => ({
  prepareOwnerReleaseBinding: vi.fn(),
  readActiveOwnerRelease: vi.fn(),
}))
const now = new Date("2026-09-30T02:00:00Z")
const input = {
  actor: { id: "operator", role: "ADMIN" } as const,
  authenticatedAt: now,
  operationId: "00000000-0000-4000-8000-000000000001",
  expectedPointerGeneration: 1,
  graphGenerationId: "a".repeat(64),
  bindingDigest: "b".repeat(64),
}
const prepared = {
  manifestId: OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
  manifestDigest: "c".repeat(64),
  graphGenerationId: input.graphGenerationId,
  bindingDigest: input.bindingDigest,
  binding: {},
  qualifiedAt: now,
  validUntil: new Date(now.getTime() + 60_000),
  dependencyExpiresAt: new Date(now.getTime() + 86_400_000),
  rawPopulationExpiresAt: new Date(now.getTime() + 86_400_000),
} as unknown as Awaited<ReturnType<typeof prepareOwnerReleaseBinding>>

function harness() {
  let release: RecommendationOwnerRelease | null = null
  const pointer = {
    generation: 1,
    stage: "CONTROL",
    activeManifestId: "incumbent",
    activeOwnerReleaseId: null as string | null,
    killSwitchEnabled: false,
    ownerInfluenceFloorGeneration: 0,
  }
  const tx = {
    $queryRaw: vi.fn(async () => [{ acquired: true }]),
    recommendationOwnerRelease: {
      findUnique: vi.fn(async () => release),
      create: vi.fn(async ({ data }) => {
        release = { ...data, revokedAt: null, revocationReason: null }
        return release!
      }),
    },
    recommendationPromotionPointer: {
      findUnique: vi.fn(async () => ({ ...pointer })),
      updateMany: vi.fn(async ({ data }) => {
        Object.assign(pointer, data)
        return { count: 1 }
      }),
    },
    recommendationExperiment: {
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
    },
    recommendationPromotionEvent: { create: vi.fn(async () => ({})) },
  }
  const prisma = { ...tx, $transaction: vi.fn(async (work) => work(tx)) }
  const invalidateCaches = vi.fn()
  const operator = new RecommendationOwnerReleaseOperator({
    prisma: prisma as unknown as PrismaClient,
    now: () => now,
    invalidateCaches,
  })
  vi.mocked(readActiveOwnerRelease).mockImplementation(async () =>
    release && !release.revokedAt && pointer.activeOwnerReleaseId === release.id
      ? {
          ...prepared,
          releaseId: release.id,
          pointerGeneration: release.pointerGeneration,
        }
      : null,
  )
  return { operator, prisma, tx, pointer, invalidateCaches }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(prepareOwnerReleaseBinding).mockResolvedValue(prepared)
})
describe("owner-approved direct release operator", () => {
  it.each([
    { id: "viewer", role: "VIEWER" },
    { id: null, role: "SYSTEM" },
    { id: "admin", role: "ADMIN", studioAuthority: "delegated" },
  ] as const)(
    "denies non-owner mutation authority before any read: %j",
    async (actor) => {
      const { operator, prisma } = harness()
      await expect(operator.prepare({ ...input, actor })).rejects.toThrow(
        /permission/i,
      )
      expect(prisma.$transaction).not.toHaveBeenCalled()
    },
  )
  it("requires recent authentication in the service and accepts no raw approval booleans", async () => {
    const { operator, prisma } = harness()
    for (const authenticatedAt of [
      null,
      new Date(now.getTime() - 900_001),
      new Date(now.getTime() + 60_001),
    ])
      await expect(
        operator.activate({ ...input, authenticatedAt }),
      ).rejects.toThrow(/recent/i)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it.each(["prepare", "activate"] as const)(
    "refuses %s even with recent owner authorization",
    async (method) => {
      const { operator, prisma, tx } = harness()
      await expect(operator[method](input)).rejects.toThrow(
        "behavioral_recommendations_retired",
      )
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(tx.recommendationOwnerRelease.create).not.toHaveBeenCalled()
      expect(
        tx.recommendationPromotionPointer.updateMany,
      ).not.toHaveBeenCalled()
    },
  )
  it("keeps read-only reconciliation available for historical operation receipts", async () => {
    const { operator, prisma } = harness()
    await expect(
      operator.reconcile({ ...input, authenticatedAt: null }),
    ).resolves.toMatchObject({ status: "not_recorded" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
