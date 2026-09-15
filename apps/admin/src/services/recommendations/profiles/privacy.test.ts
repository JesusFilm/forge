import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { eraseProfileProjectionInfluence } from "./privacy"

describe("profile projection privacy", () => {
  it("erases the exact durable generation and every linked session projection", async () => {
    const client = {
      recommendationProfileSessionLink: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { sessionDigest: "a".repeat(64) },
            { sessionDigest: "b".repeat(64) },
          ]),
      },
      recommendationProfileProjectionRun: {
        deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      recommendationProfileProjectionPointer: {
        deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      recommendationProfileProjectionGeneration: {
        deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
      },
    } as unknown as PrismaClient

    await expect(
      eraseProfileProjectionInfluence(client, {
        profileId: "profile-1",
        privacyGeneration: 4,
      }),
    ).resolves.toEqual({
      sessionDigests: 2,
      runs: 3,
      pointers: 3,
      generations: 5,
    })
    expect(
      client.recommendationProfileProjectionGeneration.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        OR: [
          { profileId: "profile-1", privacyGeneration: 4 },
          { sessionDigest: { in: ["a".repeat(64), "b".repeat(64)] } },
        ],
      },
    })
  })
})
