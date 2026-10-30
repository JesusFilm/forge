import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { StudioSourceService } from "./sources"

/** Retained synthetic footage for transaction tests; never a codec proof. */
export async function selectedSourceFixture(
  db: PrismaClient,
  user: Principal,
  language: string,
) {
  const videoId = randomUUID(),
    editionId = randomUUID(),
    dubId = randomUUID(),
    downloadId = randomUUID()
  const lang = await db.language.findUniqueOrThrow({
    where: { slug: language },
  })
  await db.video.create({
    data: {
      id: videoId,
      coreId: videoId,
      slug: videoId,
      locales: { create: { status: "PUBLISHED", title: "Source fixture" } },
    },
  })
  await db.videoEdition.create({
    data: { id: editionId, coreId: editionId, name: "Fixture" },
  })
  await db.videoDub.create({
    data: {
      id: dubId,
      coreId: dubId,
      videoId,
      videoEditionId: editionId,
      languageId: lang.id,
      published: true,
      downloadable: true,
      lengthInMilliseconds: 1000,
      hls: "https://stream.mux.com/fixture.m3u8",
      downloads: {
        create: {
          id: downloadId,
          url: "https://api-media-core.jesusfilm.org/fixture.mp4",
          height: 180,
        },
      },
    },
  })
  const snapshot = await new StudioSourceService(
    db,
    async () => Buffer.from("synthetic video bytes"),
    "LOCAL",
  ).capture(user, {
    videoId,
    editionId,
    dubId,
    downloadId,
    language,
    trackId: null,
    startMs: 0,
    endMs: 1000,
    retainOriginalBytes: true,
    idempotencyKey: randomUUID(),
  })
  return {
    id: randomUUID(),
    kind: "video" as const,
    trackId: "source-track",
    startFrame: 0,
    durationInFrames: 30,
    volume: 1,
    source: snapshot.source,
  }
}
