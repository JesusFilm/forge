import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { StudioAuthoringService } from "./index"
import { SHORTS_MODEL_TEST_DATABASE_URL } from "./database.test-support"

const suite = env.STUDIO_TEST_DATABASE_URL ? describe : describe.skip
suite("Short-owned authoring records", () => {
  let db: PrismaClient
  let service: StudioAuthoringService
  const user = {
    id: "shorts-model-operator",
    role: "ADMIN" as const,
    studioAuthority: "interactive" as const,
  }
  const document = {
    version: 1,
    title: "Independent Short",
    language: "en",
    runtimeVersion: "test",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [],
  }
  beforeAll(() => {
    if (env.STUDIO_TEST_DATABASE_URL !== SHORTS_MODEL_TEST_DATABASE_URL)
      throw new Error("Only the owned Shorts model test database is allowed")
    db = new PrismaClient({
      datasources: { db: { url: SHORTS_MODEL_TEST_DATABASE_URL } },
    })
    service = new StudioAuthoringService(db)
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  it("links multiple Shorts to one existing dub without creating output catalog objects", async () => {
    const video = await db.video.create({
      data: { coreId: randomUUID(), slug: randomUUID() },
    })
    const dub = await db.videoDub.create({
      data: { coreId: randomUUID(), videoId: video.id },
    })
    const counts = async () =>
      Promise.all([
        db.video.count(),
        db.videoDub.count(),
        db.videoEdition.count(),
        db.videoLocale.count(),
        db.videoImage.count(),
        db.muxVideo.count(),
      ])
    const before = await counts()
    const ids = [randomUUID(), randomUUID()]
    for (const id of ids)
      await service.create(user, {
        projectId: id,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        sourceVideoDubId: dub.id,
        document,
      })
    expect(
      (
        await db.videoDub.findUniqueOrThrow({
          where: { id: dub.id },
          include: { shorts: true },
        })
      ).shorts
        .map((short) => short.id)
        .sort(),
    ).toEqual(ids.sort())
    expect(await service.read(user, ids[0]!)).toMatchObject({
      sourceVideoDubId: dub.id,
    })
    expect(await counts()).toEqual(before)
    await expect(
      db.short.update({
        where: { id: ids[0] },
        data: { sourceVideoDubId: null },
      }),
    ).rejects.toThrow("Shorts project identity is immutable")
  })
  it("keeps standalone Shorts independent of a source dub", async () => {
    const id = randomUUID()
    await service.create(user, {
      projectId: id,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    expect(await db.short.findUniqueOrThrow({ where: { id } })).toMatchObject({
      sourceVideoDubId: null,
    })
    expect(await service.read(user, id)).toMatchObject({
      sourceVideoDubId: null,
    })
  })
  it("rejects a missing source dub atomically", async () => {
    const id = randomUUID()
    await expect(
      service.create(user, {
        projectId: id,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        sourceVideoDubId: randomUUID(),
        document,
      }),
    ).rejects.toThrow()
    expect(await db.short.findUnique({ where: { id } })).toBeNull()
  })
})
