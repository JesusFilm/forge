import { createServer, type Server } from "node:http"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { beforeAll, afterAll, describe, it, expect } from "vitest"
import { env } from "@/config/env"
import {
  StudioSourceService,
  assertStudioSourceEligible,
  assertStudioRenderSources,
} from "./sources"
import { StudioAssetService } from "./assets"
import {
  mapStudioSourceCues,
  parseStudioVtt,
} from "@forge/studio-contracts/sources"
const url = env.STUDIO_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
class SourceHarnessError extends Error {}
const user = {
  id: "studio-455-operator",
  role: "ADMIN" as const,
  studioAuthority: "interactive" as const,
}
suite("exact catalog source capture with real HTTP and retained bytes", () => {
  let db: PrismaClient,
    server: Server,
    origin: string,
    service: StudioSourceService
  const prefix = randomUUID()
  const vtt =
    "WEBVTT\n\n00:01.000 --> 00:02.000\nFirst\n\n00:03.000 --> 00:05.000\nSecond\n"
  const selection = {
    videoId: prefix + "video",
    dubId: prefix + "dub",
    editionId: prefix + "edition",
    trackId: prefix + "track",
    downloadId: prefix + "download",
    language: prefix + "english",
    retainOriginalBytes: true,
    startMs: 1000,
    endMs: 5000,
    idempotencyKey: randomUUID(),
  }
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (
      parsed.hostname !== "127.0.0.1" ||
      !(
        (parsed.port === "55455" &&
          parsed.pathname === "/forge_studio_455_test") ||
        (parsed.port === "55457" &&
          parsed.pathname === "/forge_studio_457_test") ||
        (parsed.port === "55459" &&
          parsed.pathname === "/forge_studio_459_test") ||
        (parsed.port === "55456" &&
          parsed.pathname === "/forge_studio_456_test")
      )
    )
      throw new SourceHarnessError(
        "Only isolated Studio test databases allowed",
      )
    db = new PrismaClient({ datasources: { db: { url } } })
    server = createServer((req, res) => {
      res.end(req.url === "/track.vtt" ? vtt : "actual source fixture bytes")
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const address = server.address()
    if (!address || typeof address === "string")
      throw new SourceHarnessError("No HTTP fixture port")
    origin = `http://127.0.0.1:${address.port}`
    service = new StudioSourceService(
      db,
      async (raw, max) => {
        if (!raw.startsWith(origin + "/"))
          throw new SourceHarnessError("Nonfixture source")
        const bytes = new Uint8Array(await (await fetch(raw)).arrayBuffer())
        if (bytes.length > max)
          throw new SourceHarnessError("Fixture too large")
        return bytes
      },
      "LOCAL",
    )
    await db.language.create({
      data: {
        id: prefix + "language",
        coreId: prefix + "language",
        slug: selection.language,
        bcp47: "en",
        name: { en: "English" },
      },
    })
    await db.video.create({
      data: {
        id: selection.videoId,
        coreId: selection.videoId,
        slug: prefix + "video",
        locales: {
          create: { locale: "en", title: "Source", status: "PUBLISHED" },
        },
      },
    })
    await db.videoEdition.create({
      data: {
        id: selection.editionId,
        coreId: selection.editionId,
        name: "Exact cut",
      },
    })
    await db.videoDub.create({
      data: {
        id: selection.dubId,
        coreId: selection.dubId,
        videoId: selection.videoId,
        videoEditionId: selection.editionId,
        languageId: prefix + "language",
        published: true,
        downloadable: true,
        hls: origin + "/stream.m3u8",
        lengthInMilliseconds: 6000,
        downloads: {
          create: {
            id: selection.downloadId,
            url: origin + "/source.mp4",
            height: 1080,
          },
        },
      },
    })
    await db.videoSubtitle.create({
      data: {
        id: selection.trackId,
        videoId: selection.videoId,
        videoEditionId: selection.editionId,
        languageId: prefix + "language",
        primary: true,
        vttSrc: origin + "/track.vtt",
      },
    })
  })
  afterAll(async () => {
    await db?.$disconnect()
    await new Promise<void>((r) => server?.close(() => r()))
  })
  it("pins exact source and subtitle bytes, maps multiple cuts and rechecks restrictions for operators", async () => {
    const descriptor = await service.capture(user, {
      ...selection,
      retainOriginalBytes: false,
      idempotencyKey: randomUUID(),
    })
    expect(descriptor.materialization).toBe("descriptor")
    expect(descriptor.originalByteDigest).toBeNull()
    await expect(
      db.$transaction((tx) =>
        assertStudioRenderSources(tx, {
          version: 1,
          title: "Descriptor preview",
          language: selection.language,
          runtimeVersion: "runtime",
          width: 1920,
          height: 1080,
          fps: 30,
          durationInFrames: 120,
          tracks: [{ id: "main", kind: "visual" }],
          components: [],
          packRevisionIds: [],
          items: [
            {
              id: "source",
              kind: "video",
              trackId: "main",
              startFrame: 0,
              durationInFrames: 120,
              source: descriptor.source,
              volume: 1,
            },
          ],
        }),
      ),
    ).rejects.toThrow("INVALID")
    const concurrentKey = randomUUID()
    const competing = await Promise.allSettled([
      service.capture(user, {
        ...selection,
        retainOriginalBytes: false,
        idempotencyKey: concurrentKey,
      }),
      service.capture(user, {
        ...selection,
        retainOriginalBytes: false,
        startMs: 2000,
        idempotencyKey: concurrentKey,
      }),
    ])
    expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(competing.filter((r) => r.status === "rejected")).toHaveLength(1)
    const snapshot = await service.capture(user, selection)
    const assetService = new StudioAssetService(db)
    const manifestRefs = []
    for (const purpose of ["preview", "export"] as const) {
      const manifest = {
        sourceSnapshotId: descriptor.id,
        catalogDigest: descriptor.catalogDigest,
        purpose,
        height: purpose === "preview" ? 180 : 1080,
        ranges: [{ startMs: 1000, endMs: 5000 }],
        media: [snapshot.source.export],
      }
      manifestRefs.push(
        (
          await assetService.register(
            { role: "SYSTEM", id: null },
            {
              filename: purpose + ".json",
              mimeType: "application/json",
              role: "manifest",
              provenance: { status: "recorded", recorded: {} },
              dependencies: manifest.media,
              idempotencyKey: randomUUID(),
            },
            Buffer.from(JSON.stringify(manifest)),
            "LOCAL",
          )
        ).reference,
      )
    }
    const materialize = {
      sourceSnapshotId: descriptor.id,
      preview: manifestRefs[0],
      export: manifestRefs[1],
      idempotencyKey: randomUUID(),
    }
    await expect(service.materialize(user, materialize)).rejects.toThrow(
      "broker",
    )
    const lowResolution = await assetService.register(
      { role: "SYSTEM", id: null },
      {
        filename: "low-resolution.json",
        mimeType: "application/json",
        role: "manifest",
        provenance: { status: "recorded", recorded: {} },
        idempotencyKey: randomUUID(),
      },
      Buffer.from(
        JSON.stringify({
          sourceSnapshotId: descriptor.id,
          catalogDigest: descriptor.catalogDigest,
          purpose: "export",
          height: 180,
          ranges: [{ startMs: 1000, endMs: 5000 }],
          media: [snapshot.source.export],
        }),
      ),
      "LOCAL",
    )
    await expect(
      service.materialize(
        { role: "SYSTEM", id: null },
        {
          ...materialize,
          export: lowResolution.reference,
          idempotencyKey: randomUUID(),
        },
      ),
    ).rejects.toThrow("INVALID")
    const staged = await service.materialize(
      { role: "SYSTEM", id: null },
      materialize,
    )
    expect(staged.materialization).toBe("broker-manifest")
    expect(staged.originalByteDigest).toBeNull()
    expect(staged.coveredRanges).toEqual([{ startMs: 1000, endMs: 5000 }])
    const eligible = await db.$transaction((tx) =>
      assertStudioRenderSources(tx, {
        version: 1,
        title: "Verified staging",
        language: selection.language,
        runtimeVersion: "runtime",
        width: 1920,
        height: 1080,
        fps: 30,
        durationInFrames: 120,
        tracks: [{ id: "main", kind: "visual" }],
        components: [],
        packRevisionIds: [],
        items: [
          {
            id: "source",
            kind: "video",
            trackId: "main",
            startFrame: 0,
            durationInFrames: 120,
            source: staged.source,
            volume: 1,
          },
        ],
      }),
    )
    expect(eligible[0]?.snapshot.id).toBe(staged.id)
    const bytes = await new StudioAssetService(db).readBytes(
      user,
      snapshot.source.subtitle.asset,
    )
    expect(Buffer.from(bytes).toString()).toBe(vtt)
    expect(snapshot.hlsUrl).toBe(origin + "/stream.m3u8")
    expect(
      mapStudioSourceCues(
        parseStudioVtt(bytes),
        [
          { startMs: 1500, endMs: 3500, startFrame: 30 },
          { startMs: 4000, endMs: 5000, startFrame: 120 },
        ],
        30,
      ),
    ).toEqual([
      { rangeIndex: 0, text: "First", startFrame: 30, endFrame: 45 },
      { rangeIndex: 0, text: "Second", startFrame: 75, endFrame: 90 },
      { rangeIndex: 1, text: "Second", startFrame: 120, endFrame: 150 },
    ])
    for (const change of [
      { language: "en" },
      { editionId: "wrong" },
      { trackId: "missing" },
      { endMs: 7000 },
    ])
      await expect(
        service.capture(user, {
          ...selection,
          ...change,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow()
    await db.video.update({
      where: { id: selection.videoId },
      data: { restrictViewPlatforms: ["mobile"] },
    })
    const current = await db.$transaction((tx) =>
      assertStudioSourceEligible(tx, snapshot),
    )
    expect(current.restrictions).toEqual(["mobile"])
    expect(snapshot.restrictions).toEqual([])
    await db.video.update({
      where: { id: selection.videoId },
      data: { restrictViewPlatforms: ["watch"] },
    })
    await expect(
      db.$transaction((tx) => assertStudioSourceEligible(tx, snapshot)),
    ).rejects.toThrow()
    await expect(
      db.video.delete({ where: { id: selection.videoId } }),
    ).rejects.toThrow()
    expect(
      Buffer.from(
        await new StudioAssetService(db).readBytes(
          user,
          snapshot.source.export,
        ),
      ).toString(),
    ).toBe("actual source fixture bytes")
  })
})
