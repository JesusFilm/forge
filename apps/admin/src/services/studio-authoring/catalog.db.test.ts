import {
  STUDIO_RENDER_TEST_DATABASE_URL,
  SHORTS_MODEL_TEST_DATABASE_URL,
} from "./database.test-support"
import { createRequire } from "node:module"
const { graphql } = createRequire(import.meta.url)(
  "graphql",
) as typeof import("graphql")
import { schema } from "@/graphql/schema"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { beforeAll, afterAll, describe, it, expect } from "vitest"
import { env } from "@/config/env"
import { StudioSourceService } from "./sources"
import { ContentPackService } from "./packs"
import { StudioCatalogService } from "./catalog"
import { StudioAuthoringService } from "./index"
import { StudioAssetService } from "./assets"
const user = { id: "catalog-operator", role: "ADMIN" as const }
const worker = { id: "catalog-worker", role: "SYSTEM" as const }
class CatalogHarnessError extends Error {}
const url = env.STUDIO_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite("generated catalog schema and service", () => {
  let db: PrismaClient
  beforeAll(() => {
    const p = new URL(url!)
    if (
      url !== SHORTS_MODEL_TEST_DATABASE_URL &&
      url !== STUDIO_RENDER_TEST_DATABASE_URL &&
      (p.hostname !== "127.0.0.1" ||
        !(
          (p.port === "55459" && p.pathname === "/forge_studio_459_test") ||
          (p.port === "55458" && p.pathname === "/forge_studio_458_test") ||
          (p.port === "55457" && p.pathname === "/forge_studio_457_test")
        ))
    )
      throw new CatalogHarnessError("Only isolated feat-459 database allowed")
    db = new PrismaClient({ datasources: { db: { url } } })
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  it("stages an owned Short release without creating catalog rows from a retained matching render and replays concurrently", async () => {
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
            ? "WEBVTT\n\n00:01.000 --> 00:05.000\nSource words\n"
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
    const requested = await author.request(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    const attempt = await db.shortAttempt.findUniqueOrThrow({
      where: { id: requested.attemptId! },
    })
    const assets = new StudioAssetService(db)
    const output = await assets.register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "output.mp4",
        mimeType: "video/mp4",
        role: "render",
        provenance: { status: "recorded", recorded: { fixture: true } },
      },
      Buffer.from("retained fixture output bytes"),
      "LOCAL",
    )
    const manifest = await assets.register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "manifest.json",
        mimeType: "application/json",
        role: "manifest",
        provenance: { status: "recorded", recorded: {} },
        dependencies: [output.reference],
      },
      Buffer.from(
        JSON.stringify({
          version: 1,
          projectId,
          revision: 1,
          renderAttemptId: attempt.id,
          inputHash: attempt.inputHash,
          output: output.reference,
          language,
          runtimeVersion: document.runtimeVersion,
          width: 1920,
          height: 1080,
          fps: 30,
          durationInFrames: 180,
          verification: {
            status: "verified",
            verifierVersion: "test-metadata-only",
            outputDigest: output.reference.digest,
          },
        }),
      ),
      "LOCAL",
    )
    await author.complete(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: attempt.id,
      status: "SUCCEEDED",
      operations: [],
      result: {
        assets: [output.reference],
        manifest: manifest.reference,
        costMicros: 0,
      },
    })
    const input = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      renderAttemptId: attempt.id,
      mux: {
        assetId: randomUUID(),
        playbackId: randomUUID(),
        policy: "signed",
        status: "ready",
      },
    }
    await expect(
      new StudioCatalogService(db).stage(user, input),
    ).rejects.toThrow()
    await db.video.update({
      where: { id: sourceId },
      data: { restrictViewPlatforms: ["watch"] },
    })
    await expect(
      new StudioCatalogService(db).stage(worker, input),
    ).rejects.toThrow()
    expect(await db.shortRelease.count({ where: { projectId } })).toBe(0)
    await db.video.update({
      where: { id: sourceId },
      data: { restrictViewPlatforms: ["arclight"] },
    })
    const catalogCounts = async () =>
      Promise.all([
        db.video.count(),
        db.videoDub.count(),
        db.videoEdition.count(),
        db.videoLocale.count(),
        db.videoImage.count(),
        db.muxVideo.count(),
      ])
    const beforeCatalog = await catalogCounts()
    const other = new PrismaClient({ datasources: { db: { url } } })
    try {
      const [first, second] = await Promise.all([
        new StudioCatalogService(db).stage(worker, input),
        new StudioCatalogService(other).stage(worker, input),
      ])
      expect(first.id).toBe(second.id)
      const sourceQuery = `query($id: ID!) { shortsCatalogRelease(id:$id) { id title snapshot } }`
      const denied = await graphql({
        schema,
        source: sourceQuery,
        variableValues: { id: first.id },
        contextValue: { user: null, prisma: db },
      })
      expect(denied.errors).toBeDefined()
      const allowed = await graphql({
        schema,
        source: sourceQuery,
        variableValues: { id: first.id },
        contextValue: { user, prisma: db },
      })
      expect(allowed.errors).toBeUndefined()
      const staged = await graphql({
        schema,
        source: `mutation($input: JSON!) { stageShortsCatalog(input:$input) { id title } }`,
        variableValues: { input },
        contextValue: { user: worker, prisma: db },
      })
      expect(staged.errors).toBeUndefined()
      expect(staged.data?.stageShortsCatalog).toEqual({
        id: first.id,
        title: document.title,
      })
      const saved = await new StudioCatalogService(db).read(user, first.id)
      expect(await catalogCounts()).toEqual(beforeCatalog)
      expect(saved).toMatchObject({
        title: document.title,
        languageSlug: document.language,
        width: document.width,
        height: document.height,
        fps: document.fps,
        durationMs: Math.round(
          (document.durationInFrames * 1000) / document.fps,
        ),
        muxAssetId: input.mux.assetId,
        muxPlaybackId: input.mux.playbackId,
      })
      expect(saved.snapshot).toMatchObject({
        document,
        manifest: { projectId, revision: 1 },
        restrictions: ["arclight"],
      })
      expect(saved.derivations[0]).toMatchObject({
        sourceSnapshotId: source.id,
        startMs: 1000,
        endMs: 5000,
        startFrame: 30,
        durationInFrames: 120,
        sourceSnapshot: { videoId: sourceId, dubId, editionId, trackId },
      })
      expect(saved.packs[0]?.packRevisionId).toBe(pack.id)
      await expect(
        new StudioCatalogService(db).stage(worker, {
          ...input,
          mux: { ...input.mux, assetId: "different" },
        }),
      ).rejects.toThrow()
      await expect(
        db.shortRelease.update({
          where: { id: saved.id },
          data: { title: "Replacement" },
        }),
      ).rejects.toThrow()
      await author.apply(user, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        operations: [{ kind: "set-metadata", title: "Edited draft" }],
      })
      expect(
        (await new StudioCatalogService(db).read(user, first.id)).snapshot,
      ).toEqual(saved.snapshot)
      expect((await new StudioCatalogService(db).stage(worker, input)).id).toBe(
        first.id,
      )
    } finally {
      await other.$disconnect()
    }
  })
})
