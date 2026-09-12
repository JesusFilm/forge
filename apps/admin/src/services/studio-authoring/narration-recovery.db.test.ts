import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { StudioAssetService } from "./assets"
import { StudioAuthoringService } from "./index"
import { StudioNarrationService } from "./narration"
import { StudioExecutionService } from "./execution"
import { env } from "@/config/env"

// S3 returns Uint8Array; local reads return Buffer. Keep the real retained
// bytes while exercising the production storage representation.
vi.mock("@/storage/media", async (original) => {
  const media = await original<typeof import("@/storage/media")>()
  return {
    ...media,
    readMediaObject: async (
      ...args: Parameters<typeof media.readMediaObject>
    ) => new Uint8Array(await media.readMediaObject(...args)),
  }
})
vi.mock("@/config/env", async (original) => {
  const config = await original<typeof import("@/config/env")>()
  return { env: { ...config.env, STUDIO_PRODUCTION_ENABLED: "true" } }
})
const url = env.STUDIO_TEST_DATABASE_URL
const human = {
  id: "narration-recovery",
  role: "ADMIN" as const,
  studioAuthority: "interactive" as const,
}
const worker = { id: null, role: "MANAGER_BACKEND" as const }
class FixtureError extends Error {}
;(url ? describe : describe.skip)(
  "Narration with production storage bytes",
  () => {
    let db: PrismaClient
    beforeAll(() => {
      if (
        url !== "postgresql://tataihono@127.0.0.1:55460/forge_studio_491_test"
      )
        throw new FixtureError("Use task-owned database only")
      db = new PrismaClient({ datasources: { db: { url } } })
    })
    afterAll(async () => {
      await db?.$disconnect()
    })
    it("attaches six retained recordings and replays completion without provider calls", async () => {
      const assets = new StudioAssetService(db)
      const commands = new StudioAuthoringService(db)
      const preset = {
        language: "english",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "hpp4J3VqNfWAUOO0d1Us",
        settings: {
          stability: 0.5,
          language_code: "en",
          similarity_boost: 0.75,
        },
        pronunciation: null,
      }
      const voice = await assets.register(
        human,
        {
          idempotencyKey: randomUUID(),
          filename: "voice.json",
          mimeType: "application/json",
          role: "voice",
          provenance: {
            status: "recorded",
            recorded: { registrationStatus: "existing" },
          },
          voice: preset,
        },
        Buffer.from(JSON.stringify(preset)),
        "LOCAL",
      )
      const items = Array.from({ length: 6 }, (_, i) => ({
        id: `card-${i}`,
        kind: "text" as const,
        trackId: "cards",
        startFrame: i * 300,
        durationInFrames: 300,
        text: `Card ${i}`,
        properties: {},
        speech: {
          text: `Peace in the storm. Reflection ${i}.`,
          role: "narration",
          suppressed: false,
          voice: voice.reference,
          provider: preset.provider,
          model: preset.model,
          settings: preset.settings,
          pronunciation: null,
        },
      }))
      const projectId = randomUUID()
      await commands.create(human, {
        projectId,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document: {
          version: 1,
          title: "Retained narration",
          language: "english",
          runtimeVersion: "studio-proof-1",
          width: 1080,
          height: 1920,
          fps: 30,
          durationInFrames: 1800,
          tracks: [{ id: "cards", kind: "visual" }],
          components: [],
          packRevisionIds: [],
          items,
        },
      })
      await commands.approve(human, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        kind: "SCRIPT",
      })
      const attempt = await commands.request(human, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        kind: "NARRATION",
        instructions: [],
      })
      const execution = new StudioExecutionService(db)
      const run = await execution.admit(human, {
        attemptId: attempt.attemptId,
        maxCostMicros: 0,
      })
      const entries = []
      for (const [i, item] of items.entries()) {
        const narration = await assets.narrationIdentity(
          human,
          "english",
          item.speech,
        )
        const durationMs = [5695, 6165, 6348, 5251, 5747, 5147][i]!
        const audio = await assets.register(
          worker,
          {
            idempotencyKey: randomUUID(),
            filename: "narration.mp3",
            mimeType: "audio/mpeg",
            role: "narration",
            narration,
            provenance: {
              status: "recorded",
              recorded: { durationMs, mediaValidated: true },
            },
          },
          Buffer.from(`retained audio ${i}`),
          "LOCAL",
        )
        expect(
          (await assets.findNarration(human, narration)).map(
            (a) => a.reference,
          ),
        ).toContainEqual(audio.reference)
        entries.push({ itemId: item.id, asset: audio.reference, durationMs })
      }
      const chunk = await assets.register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "chunk.json",
          mimeType: "application/json",
          role: "manifest",
          dependencies: entries.map((e) => e.asset),
          provenance: { status: "recorded", recorded: {} },
        },
        Buffer.from(JSON.stringify({ version: 1, entries })),
        "LOCAL",
      )
      const manifest = await assets.register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "manifest.json",
          mimeType: "application/json",
          role: "manifest",
          dependencies: [chunk.reference],
          provenance: { status: "recorded", recorded: {} },
        },
        Buffer.from(JSON.stringify({ version: 1, chunks: [chunk.reference] })),
        "LOCAL",
      )
      const command = {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        attemptId: attempt.attemptId,
        manifest: manifest.reference,
        costMicros: 0,
      }
      const service = new StudioNarrationService(db)
      const result = await service.complete(worker, command)
      expect(result).toMatchObject({ revision: 2, outcome: "ACCEPTED" })
      expect(await service.complete(worker, command)).toEqual(result)
      const saved = await commands.read(human, projectId)
      const attached = saved.document.items.filter((i) => i.kind === "audio")
      expect(attached).toHaveLength(6)
      for (const entry of entries)
        expect(attached).toContainEqual(
          expect.objectContaining({
            narrationFor: entry.itemId,
            asset: entry.asset,
          }),
        )
      const observed = await execution.read(worker, run.id)
      expect(observed).toMatchObject({ state: "COMPLETED", calls: [] })
    })
  },
)
