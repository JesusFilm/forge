import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { describe, it, expect } from "vitest"
import { env } from "@/config/env"
import { StudioSourceService, assertStudioRenderSources } from "./sources"
import { ContentPackService } from "./packs"
import { StudioAuthoringService } from "./index"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { StudioAssetService, byteDigest } from "./assets"
class SourceRevisionHarnessError extends Error {}
const url = env.STUDIO_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const user = { id: "source-revision-operator", role: "ADMIN" as const }
suite("retained source and pack revision INSERT", () => {
  it("persists actual source items and rejects a mismatched retained tuple", async () => {
    const parsed = new URL(url!)
    if (
      parsed.hostname !== "127.0.0.1" ||
      !(
        (parsed.port === "55457" &&
          parsed.pathname === "/forge_studio_457_test") ||
        (parsed.port === "55459" &&
          parsed.pathname === "/forge_studio_459_test") ||
        (parsed.port === "55456" &&
          parsed.pathname === "/forge_studio_456_test")
      )
    )
      throw new SourceRevisionHarnessError(
        "Only isolated Studio test databases allowed",
      )
    const db = new PrismaClient({ datasources: { db: { url } } })
    try {
      const projectId = randomUUID(),
        language = randomUUID()
      await db.language.create({
        data: {
          coreId: language,
          slug: language,
          bcp47: "en",
          name: { en: "English" },
        },
      })
      const sourceId = randomUUID(),
        editionId = randomUUID(),
        dubId = randomUUID(),
        trackId = randomUUID(),
        downloadId = randomUUID()
      const lang = await db.language.findUniqueOrThrow({
        where: { coreId: language },
      })
      await db.video.create({
        data: {
          id: sourceId,
          coreId: sourceId,
          slug: sourceId,
          locales: { create: { status: "PUBLISHED", title: "Source" } },
        },
      })
      await db.videoEdition.create({
        data: { id: editionId, coreId: editionId, name: "Source edition" },
      })
      await db.videoDub.create({
        data: {
          id: dubId,
          coreId: dubId,
          videoId: sourceId,
          videoEditionId: editionId,
          languageId: lang.id,
          published: true,
          downloadable: true,
          lengthInMilliseconds: 10000,
          hls: "https://stream.mux.com/source.m3u8",
          downloads: {
            create: {
              id: downloadId,
              url: "https://api-media-core.jesusfilm.org/source.mp4",
              height: 1080,
            },
          },
        },
      })
      await db.videoSubtitle.create({
        data: {
          id: trackId,
          videoId: sourceId,
          videoEditionId: editionId,
          languageId: lang.id,
          vttSrc: "https://api-media-core.jesusfilm.org/source.vtt",
        },
      })
      const capture = new StudioSourceService(
        db,
        async (url) =>
          Buffer.from(
            url.endsWith(".vtt")
              ? "WEBVTT\n\n00:01.000 --> 00:05.000\nSource words\n\n00:08.000 --> 00:09.000\n<b>Distant words</b>\n"
              : "source byte fixture",
          ),
        "LOCAL",
      )
      const selected = {
        videoId: sourceId,
        dubId,
        editionId,
        trackId,
        downloadId,
        language,
        startMs: 1000,
        endMs: 5000,
        retainOriginalBytes: true,
        idempotencyKey: randomUUID(),
      }
      await expect(
        capture.capture(user, { ...selected, editionId: randomUUID() }),
      ).rejects.toThrow()
      const source = await capture.capture(user, selected)
      const pack = await new ContentPackService(db).write(user, {
        packId: randomUUID(),
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document: {
          title: "Evidence",
          guidance: "Reflect",
          sources: [
            {
              label: "Actual passage",
              excerpt: "Source words",
              sourceSnapshotId: source.id,
              asset: source.source.subtitle.asset,
            },
          ],
        },
      })
      // Restriction was added AFTER selection. Current policy must flow to output.
      await db.video.update({
        where: { id: sourceId },
        data: { restrictViewPlatforms: ["arclight"] },
      })
      const document = {
        version: 1,
        title: "Generated film",
        language,
        runtimeVersion: "studio-proof-1",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 180,
        tracks: [{ id: "main", kind: "visual" }],
        components: [],
        items: [
          {
            id: "clip",
            kind: "video",
            trackId: "main",
            startFrame: 30,
            durationInFrames: 120,
            source: source.source,
            volume: 1,
          },
        ],
        packRevisionIds: [pack.id],
      }
      const author = new StudioAuthoringService(db)
      await author.create(user, {
        projectId,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document,
      })
      const saved = await author.read(user, projectId)
      expect(saved.document.items).toEqual(document.items)
      expect(saved.document.packRevisionIds).toEqual([pack.id])
      const canonicalBytes = await new StudioAssetService(db).readBytes(
        user,
        source.source.subtitle.asset,
      )
      expect(byteDigest(canonicalBytes)).toBe(
        source.source.subtitle.asset.digest,
      )
      expect(new TextDecoder().decode(canonicalBytes)).toContain(
        "<b>Distant words</b>",
      )
      const expanded = studioDocumentSchema.parse({
        ...saved.document,
        durationInFrames: 300,
        items: saved.document.items.map((item) =>
          item.kind === "video"
            ? {
                ...item,
                durationInFrames: 240,
                source: { ...item.source, endMs: 9000 },
              }
            : item,
        ),
      })
      await expect(
        author.apply(user, {
          projectId,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
          operations: [{ kind: "restore-document", document: expanded }],
        }),
      ).rejects.toThrow("Unsupported subtitle cue")
      await expect(
        db.$transaction((tx) => assertStudioRenderSources(tx, expanded)),
      ).rejects.toThrow("Unsupported subtitle cue")
      expect((await author.read(user, projectId)).revision).toBe(1)
      await expect(
        db.$transaction(async (tx) => {
          const invalid = {
            ...document,
            items: [
              {
                ...document.items[0],
                source: { ...source.source, editionId: "incorrect-edition" },
              },
            ],
          }
          await tx.studioProjectRevision.create({
            data: {
              projectId,
              number: 2,
              document: invalid,
              actor: { kind: "human", id: user.id },
            },
          })
        }),
      ).rejects.toThrow("Invalid pinned source or range")
    } finally {
      await db.$disconnect()
    }
  })
})
