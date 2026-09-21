import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import {
  isPushDestinationPublished,
  pushExperienceDestinationWhere,
  pushVideoDestinationWhere,
} from "./destinations"

type CountArgs = { where: Record<string, unknown> }

function countingClient(answer: number) {
  const video = { count: vi.fn(async (_args: CountArgs) => answer) }
  const experienceLocale = {
    count: vi.fn(async (_args: CountArgs) => answer),
  }
  return {
    prisma: { video, experienceLocale } as unknown as PrismaClient,
    video,
    experienceLocale,
  }
}

describe("pushVideoDestinationWhere", () => {
  it("carries publication, liveness, and the watch restriction beside the label", () => {
    expect(pushVideoDestinationWhere("VIDEO")).toEqual({
      deletedAt: null,
      label: { notIn: ["SERIES", "COLLECTION"] },
      locales: { some: { status: "PUBLISHED", deletedAt: null } },
      NOT: { restrictViewPlatforms: { has: "watch" } },
    })
    expect(pushVideoDestinationWhere("SERIES").label).toEqual({
      in: ["SERIES", "COLLECTION"],
    })
  })
})

describe("pushExperienceDestinationWhere", () => {
  it("reads only published locales of unarchived experiences", () => {
    expect(pushExperienceDestinationWhere()).toEqual({
      status: "PUBLISHED",
      experience: { archivedAt: null },
    })
  })
})

describe("isPushDestinationPublished", () => {
  it("is true when one published video carries the slug", async () => {
    const { prisma, video, experienceLocale } = countingClient(1)

    await expect(
      isPushDestinationPublished(prisma, { kind: "VIDEO", slug: "jesus" }),
    ).resolves.toBe(true)

    const [read] = video.count.mock.calls[0]
    expect(read.where).toMatchObject({
      slug: "jesus",
      deletedAt: null,
      locales: { some: { status: "PUBLISHED", deletedAt: null } },
      NOT: { restrictViewPlatforms: { has: "watch" } },
    })
    expect(experienceLocale.count).not.toHaveBeenCalled()
  })

  it("is false when no published row carries the slug", async () => {
    const { prisma } = countingClient(0)

    await expect(
      isPushDestinationPublished(prisma, { kind: "SERIES", slug: "draft" }),
    ).resolves.toBe(false)
  })

  it("reads an experience through its published locale", async () => {
    const { prisma, video, experienceLocale } = countingClient(1)

    await expect(
      isPushDestinationPublished(prisma, {
        kind: "EXPERIENCE",
        slug: "easter",
      }),
    ).resolves.toBe(true)

    const [read] = experienceLocale.count.mock.calls[0]
    expect(read.where).toEqual({
      slug: "easter",
      status: "PUBLISHED",
      experience: { archivedAt: null },
    })
    expect(video.count).not.toHaveBeenCalled()
  })
})
