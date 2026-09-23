import { randomUUID } from "node:crypto"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient, type Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { getSelectedBlockVideoDubs } from "./selected-block-video-dub.service"

describe.skipIf(process.env.BLOCK_DUB_DB_TEST !== "1")(
  "authored dub PostgreSQL parity",
  () => {
    const prefix = `block-dub-${randomUUID()}`
    let db: PrismaClient
    const id = (suffix: string) => `${prefix}-${suffix}`
    const identity = (video: string, language = "en") => ({
      videoId: id(video),
      languageId: id(language),
    })
    const query = {
      select: {
        id: true,
        videoId: true,
        languageId: true,
        duration: true,
        hls: true,
        dash: true,
        share: true,
        language: { select: { id: true, slug: true } },
      },
    } satisfies Prisma.VideoDubFindManyArgs
    const scalar = (key: ReturnType<typeof identity>) =>
      db.videoDub.findFirst({
        ...query,
        where: {
          ...key,
          deletedAt: null,
          published: true,
          OR: [
            { hls: { not: null } },
            { dash: { not: null } },
            { share: { not: null } },
          ],
          video: { deletedAt: null },
        },
        orderBy: [{ duration: "desc" }, { id: "asc" }],
      })

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!)
      if (!["127.0.0.1", "localhost"].includes(url.hostname))
        throw new Error("Owned local fixture required")
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 10 }),
      })
      await db.language.createMany({
        data: ["en", "fr"].map((language) => ({
          id: id(language),
          coreId: id(language),
          slug: id(language),
        })),
      })
      await db.video.createMany({
        data: [
          "tie",
          "null",
          "dash",
          "share",
          "blank",
          "withdrawn",
          "deleted",
          "silent",
          "languages",
        ].map((video) => ({
          id: id(video),
          coreId: id(video),
          slug: id(video),
          deletedAt: video === "deleted" ? new Date() : null,
        })),
      })
      const row = (
        suffix: string,
        video: string,
        overrides: Partial<Prisma.VideoDubCreateManyInput> = {},
      ): Prisma.VideoDubCreateManyInput => ({
        id: id(suffix),
        coreId: id(suffix),
        ...identity(video),
        published: true,
        hls: "fixture.m3u8",
        duration: 100,
        ...overrides,
      })
      await db.videoDub.createMany({
        data: [
          row("tie-a", "tie"),
          row("tie-b", "tie"),
          row("tie-long-withdrawn", "tie", {
            duration: 1000,
            published: false,
          }),
          row("tie-long-deleted", "tie", {
            duration: 1000,
            deletedAt: new Date(),
          }),
          row("null-duration", "null", { duration: null }),
          row("null-long", "null", { duration: 1000 }),
          row("dash-only", "dash", { hls: null, dash: "fixture.mpd" }),
          row("share-only", "share", { hls: null, share: "fixture-share" }),
          row("blank-hls", "blank", { hls: "" }),
          row("withdrawn-dub", "withdrawn", { published: false }),
          row("deleted-video-dub", "deleted"),
          row("silent-dub", "silent", { hls: null }),
          row("languages-en", "languages"),
          row("languages-fr", "languages", {
            languageId: id("fr"),
            duration: 10000,
          }),
        ],
      })
    })
    afterAll(async () => {
      if (!db) return
      try {
        await db.video.deleteMany({ where: { id: { startsWith: prefix } } })
        await db.language.deleteMany({ where: { id: { startsWith: prefix } } })
      } finally {
        await db.$disconnect()
      }
    })

    it("matches the scalar winner and nested language for ties, null ordering and exact language pairs", async () => {
      const keys = [
        identity("tie"),
        identity("null"),
        identity("languages", "fr"),
        identity("languages"),
        identity("tie"),
      ]
      const rows = await getSelectedBlockVideoDubs(db, keys, query)
      expect(rows).toEqual(await Promise.all(keys.map(scalar)))
      expect(rows.map((row) => row?.id)).toEqual([
        id("tie-a"),
        id("null-duration"),
        id("languages-fr"),
        id("languages-en"),
        id("tie-a"),
      ])
    })

    it("preserves DASH/share/blank-HLS eligibility and excludes unavailable identities", async () => {
      const keys = [
        "dash",
        "share",
        "blank",
        "withdrawn",
        "deleted",
        "silent",
        "missing",
      ].map((video) => identity(video))
      const rows = await getSelectedBlockVideoDubs(db, keys, query)
      expect(rows).toEqual(await Promise.all(keys.map(scalar)))
      expect(rows.map((row) => row?.id ?? null)).toEqual([
        id("dash-only"),
        id("share-only"),
        id("blank-hls"),
        null,
        null,
        null,
        null,
      ])
    })
  },
)
