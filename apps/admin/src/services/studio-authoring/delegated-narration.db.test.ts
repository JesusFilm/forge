import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { env } from "@/config/env"
import { STUDIO_RENDER_TEST_DATABASE_URL } from "./database.test-support"
import { StudioAssetService } from "./assets"
import { StudioAuthoringService } from "./index"
import { executeStudioDelegated } from "./delegated"
import { executeStudioProduction } from "./production-rpc"
import {
  StudioDelegatedNarrationService,
  readDelegatedNarrationPlan,
} from "./delegated-narration"
import { studioHash, publicationDependencyHash, lockProject } from "./state"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"

class FixtureError extends Error {}
const url = env.STUDIO_TEST_DATABASE_URL
const worker = { id: null, role: "MANAGER_BACKEND" as const }
const acceptedSchema = z.object({
  runId: z.string(),
  attemptId: z.string(),
  allowance: z.object({ used: z.number(), remaining: z.number() }),
})
;(url ? describe : describe.skip)(
  "Delegated draft narration against real persistence",
  () => {
    let db: PrismaClient
    beforeAll(() => {
      if (url !== STUDIO_RENDER_TEST_DATABASE_URL)
        throw new FixtureError("Task-owned loopback database required")
      db = new PrismaClient({ datasources: { db: { url } } })
    })
    afterAll(async () => {
      await db?.$disconnect()
    })
    async function fixture() {
      const id = randomUUID()
      await db.user.create({
        data: {
          id,
          name: "Narration operator",
          email: `${id}@example.test`,
          role: "EDITOR",
          managerMembership: { create: { role: "OPERATOR" } },
        },
      })
      const human = {
        id,
        role: "EDITOR" as const,
        managerRole: "OPERATOR" as const,
        studioAuthority: "interactive" as const,
      }
      const caller = {
        sub: id,
        authority: "delegated" as const,
        clientId: "claude",
        scopes: ["shorts:read", "shorts:edit", "shorts:narration"],
      }
      const assets = new StudioAssetService(db),
        commands = new StudioAuthoringService(db)
      const preset = {
        language: "en",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: randomUUID(),
        settings: {},
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
      const speech = {
        text: "A hopeful moment.",
        role: "narration",
        suppressed: false,
        voice: voice.reference,
        provider: preset.provider,
        model: preset.model,
        settings: {},
        pronunciation: null,
      }
      const projectId = randomUUID()
      await commands.create(human, {
        projectId,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        document: {
          version: 1,
          title: "Draft",
          language: "en",
          runtimeVersion: "studio-proof-1",
          width: 1080,
          height: 1920,
          fps: 30,
          durationInFrames: 60,
          tracks: [{ id: "main", kind: "visual" }],
          components: [],
          packRevisionIds: [],
          items: [0, 1].map((i) => ({
            id: `speech${i}`,
            kind: "text",
            trackId: "main",
            startFrame: i * 30,
            durationInFrames: 30,
            text: "Hope",
            properties: {},
            speech: { ...speech, text: `${speech.text} ${i}` },
          })),
        },
      })
      const production = (runId: string, command: string, input: unknown) =>
        executeStudioProduction(
          db,
          {
            sub: id,
            authority: "delegated",
            clientId: "shorts-production",
            scopes: ["shorts:production:execute"],
          },
          { action: "production", runId, command, input },
        )
      const admit = (
        expectedRevision: number,
        key = randomUUID(),
        clientId = "claude",
      ) =>
        executeStudioDelegated(
          db,
          { ...caller, clientId },
          {
            action: "narration-admit",
            input: { projectId, expectedRevision, idempotencyKey: key },
          },
        ).then((v) => acceptedSchema.parse(v))
      let paid = 0
      async function finish(
        runId: string,
        beforeAttach?: () => Promise<unknown>,
        faults?: {
          afterClaim?: () => Promise<unknown>
          afterFinish?: () => Promise<unknown>
        },
      ) {
        const plan = (await readDelegatedNarrationPlan(db, runId))!
        const entries = []
        for (const s of plan.segments) {
          let ref = s.matches[0]
          if (!ref) {
            const digest = studioHash(s.identity),
              key = `speech-${digest}`
            const claim = z
              .object({
                execute: z.boolean(),
                call: z.object({ result: z.unknown().nullable() }),
              })
              .parse(
                await production(runId, "claim", {
                  key,
                  inputDigest: digest,
                  reserveMicros: 0,
                }),
              )
            if (claim.execute) {
              await faults?.afterClaim?.()
              paid++
              const asset = await assets.register(
                worker,
                {
                  idempotencyKey: `${runId}:${key}`,
                  filename: "audio.mp3",
                  mimeType: "audio/mpeg",
                  role: "narration",
                  narration: s.identity,
                  provenance: {
                    status: "recorded",
                    recorded: { durationMs: 1000, mediaValidated: true, runId },
                  },
                },
                Buffer.from(`fake-provider:${digest}`),
                "LOCAL",
              )
              ref = asset.reference
              await production(runId, "finish", {
                key,
                state: "COMPLETED",
                result: {
                  assets: [ref],
                  actualCostMicros: null,
                  credits: 1,
                  requestId: key,
                  elapsedMs: 1,
                },
              })
              await faults?.afterFinish?.()
            } else
              ref = z
                .object({ assets: z.array(studioAssetReferenceSchema) })
                .parse(claim.call.result).assets[0]!
          }
          entries.push({ itemId: s.itemId, asset: ref, durationMs: 1000 })
        }
        const chunk = await assets.register(
          worker,
          {
            idempotencyKey: `${runId}:chunk`,
            filename: "chunk.json",
            mimeType: "application/json",
            role: "manifest",
            dependencies: entries.map((e) => e.asset),
            provenance: { status: "recorded", recorded: { runId } },
          },
          Buffer.from(JSON.stringify({ version: 1, entries })),
          "LOCAL",
        )
        const manifest = await assets.register(
          worker,
          {
            idempotencyKey: `${runId}:manifest`,
            filename: "manifest.json",
            mimeType: "application/json",
            role: "manifest",
            dependencies: [chunk.reference],
            provenance: { status: "recorded", recorded: { runId } },
          },
          Buffer.from(
            JSON.stringify({ version: 1, chunks: [chunk.reference] }),
          ),
          "LOCAL",
        )
        await beforeAttach?.()
        return production(runId, "narration-complete", {
          idempotencyKey: `${runId}:complete`,
          manifest: manifest.reference,
          costMicros: null,
        })
      }
      const edit = async (text: string) => {
        const p = await commands.read(human, projectId)
        return commands.apply(human, {
          projectId,
          expectedRevision: p.revision,
          idempotencyKey: randomUUID(),
          operations: [
            {
              kind: "set-speech",
              itemId: "speech0",
              speech: { ...speech, text },
            },
          ],
        })
      }
      return {
        human,
        caller,
        commands,
        projectId,
        admit,
        production,
        finish,
        edit,
        paid: () => paid,
      }
    }
    it("admits one atomic multi-item initial pass, reuses audio for visuals, corrects once and grants only interactively", async () => {
      const f = await fixture(),
        key = randomUUID()
      await expect(
        executeStudioDelegated(
          db,
          { ...f.caller, scopes: ["shorts:edit"] },
          {
            action: "narration-admit",
            input: {
              projectId: f.projectId,
              expectedRevision: 1,
              idempotencyKey: key,
            },
          },
        ),
      ).rejects.toThrow("scope")
      const attempts = await Promise.allSettled([
        f.admit(1, key),
        f.admit(1, randomUUID(), "codex"),
      ])
      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1)
      const initial = attempts.find((a) => a.status === "fulfilled")!
      if (initial.status !== "fulfilled")
        throw new FixtureError("Admission missing")
      expect(initial.value.allowance).toEqual({ used: 1, remaining: 1 })
      expect(
        await db.shortApproval.count({ where: { projectId: f.projectId } }),
      ).toBe(0)
      await f.finish(initial.value.runId)
      expect(f.paid()).toBe(2)
      const p = await f.commands.read(f.human, f.projectId)
      await f.commands.apply(f.human, {
        projectId: f.projectId,
        expectedRevision: p.revision,
        idempotencyKey: randomUUID(),
        operations: [{ kind: "set-metadata", title: "Human visual edit" }],
      })
      const visual = await f.admit(p.revision + 1)
      expect(visual.allowance.used).toBe(1)
      await f.finish(visual.runId)
      expect(f.paid()).toBe(2)
      const edited = await f.edit("A corrected hopeful moment.")
      const correction = await f.admit(edited.revision)
      expect(correction.allowance).toEqual({ used: 2, remaining: 0 })
      await f.finish(correction.runId)
      expect(f.paid()).toBe(3)
      const changed = await f.edit("Another correction needs authorization.")
      await expect(f.admit(changed.revision)).rejects.toThrow("exhausted")
      const service = new StudioDelegatedNarrationService(db)
      const authorization = {
        projectId: f.projectId,
        expectedRevision: changed.revision,
        idempotencyKey: randomUUID(),
        additionalPasses: 1,
        confirmed: true,
      }
      await expect(
        service.authorize(
          { ...f.human, studioAuthority: "delegated" },
          authorization,
        ),
      ).rejects.toThrow("Interactive")
      await service.authorize(f.human, authorization)
      await service.authorize(f.human, authorization)
      expect((await f.admit(changed.revision)).allowance).toEqual({
        used: 3,
        remaining: 0,
      })
    })
    it("replays accepted responses after edits and retains stale paid output without overwriting the human", async () => {
      const f = await fixture(),
        key = randomUUID(),
        admitted = await f.admit(1, key)
      await f.finish(admitted.runId, () =>
        f.edit("Human correction while provider is running"),
      )
      expect((await f.admit(1, key)).runId).toBe(admitted.runId)
      expect(
        (
          await db.shortAttempt.findUniqueOrThrow({
            where: { id: admitted.attemptId },
          })
        ).status,
      ).toBe("STALE")
      const p = await f.commands.read(f.human, f.projectId)
      expect(p.document.items[0]!.speech?.text).toBe(
        "Human correction while provider is running",
      )
      expect(p.document.items.filter((i) => i.kind === "audio")).toHaveLength(0)
      expect(f.paid()).toBe(2)
    })
    it("requires exact human script and voice review independently of delegated narration", async () => {
      const f = await fixture()
      const admitted = await f.admit(1)
      await f.finish(admitted.runId)
      const project = await f.commands.read(f.human, f.projectId)
      expect(project.actor).toMatchObject({
        authority: "delegated",
        clientId: "claude",
        id: f.human.id,
      })
      const render = await f.commands.request(f.human, {
        projectId: f.projectId,
        expectedRevision: project.revision,
        idempotencyKey: randomUUID(),
        kind: "RENDER",
        instructions: [],
      })
      const assets = new StudioAssetService(db)
      const manifest = await assets.register(
        worker,
        {
          idempotencyKey: randomUUID(),
          filename: "render.json",
          mimeType: "application/json",
          role: "manifest",
          provenance: { status: "recorded", recorded: {} },
        },
        Buffer.from("{}"),
        "LOCAL",
      )
      await f.commands.complete(worker, {
        projectId: f.projectId,
        expectedRevision: project.revision,
        idempotencyKey: randomUUID(),
        attemptId: render.attemptId,
        status: "SUCCEEDED",
        operations: [],
        result: { assets: [], manifest: manifest.reference, costMicros: 0 },
      })
      const dependency = () =>
        db.$transaction(async (tx) =>
          publicationDependencyHash(
            tx,
            await lockProject(tx, f.projectId),
            project.document,
            render.attemptId!,
          ),
        )
      await expect(dependency()).rejects.toThrow("APPROVAL_REQUIRED")
      await f.commands.approve(f.human, {
        projectId: f.projectId,
        expectedRevision: project.revision,
        idempotencyKey: randomUUID(),
        kind: "SCRIPT",
      })
      expect(await dependency()).toMatch(/^[a-f0-9]{64}$/)
      const changedVoice = structuredClone(project.document)
      changedVoice.items[0]!.speech!.settings = { stability: 0.9 }
      await expect(
        db.$transaction(async (tx) =>
          publicationDependencyHash(
            tx,
            await lockProject(tx, f.projectId),
            changedVoice,
            render.attemptId!,
          ),
        ),
      ).rejects.toThrow("APPROVAL_REQUIRED")
    })
    it("retains deduplicated retry guidance before any dispatch without consuming or terminalizing paid work", async () => {
      const f = await fixture(),
        admitted = await f.admit(1)
      const diagnostic =
        "Context unavailable before dispatch; resume original request"
      await f.production(admitted.runId, "reconciliation-note", { diagnostic })
      await f.production(admitted.runId, "reconciliation-note", { diagnostic })
      const status = await new StudioDelegatedNarrationService(db).status(
        f.human,
        { projectId: f.projectId },
      )
      expect(status).toMatchObject({
        used: 1,
        remaining: 1,
        runs: [
          expect.objectContaining({
            state: "READY",
            calls: [
              expect.objectContaining({
                state: "COMPLETED",
                result: expect.objectContaining({
                  diagnostic,
                  actualCostMicros: 0,
                  providerMetadata: expect.objectContaining({
                    diagnosticOnly: true,
                    providerDispatched: false,
                    recovery: expect.stringContaining(
                      "original narration idempotency key",
                    ),
                  }),
                }),
              }),
            ],
          }),
        ],
      })
      await f.finish(admitted.runId)
      expect(f.paid()).toBe(2)
      expect(
        (
          await db.shortAttempt.findUniqueOrThrow({
            where: { id: admitted.attemptId },
          })
        ).status,
      ).toBe("SUCCEEDED")
    })
    it("keeps retained successful calls resumable after a lost finish response", async () => {
      const f = await fixture(),
        key = randomUUID(),
        admitted = await f.admit(1, key)
      await expect(
        f.finish(admitted.runId, undefined, {
          afterFinish: async () => {
            throw new FixtureError("Lost finish response")
          },
        }),
      ).rejects.toThrow("Lost finish response")
      expect(f.paid()).toBe(1)
      expect(
        await f.production(admitted.runId, "preflight-error", {
          diagnostic: "Lost finish response",
        }),
      ).toMatchObject({
        recorded: true,
        outcome: "RECONCILIATION_REQUIRED",
        run: { state: "READY" },
      })
      expect(
        (
          await db.shortAttempt.findUniqueOrThrow({
            where: { id: admitted.attemptId },
          })
        ).status,
      ).toBe("QUEUED")
      expect((await f.admit(1, key)).runId).toBe(admitted.runId)
      await f.finish(admitted.runId)
      expect(f.paid()).toBe(2) // two distinct segments, no repeated paid call
      expect(
        (await f.commands.read(f.human, f.projectId)).document.items.filter(
          (i) => i.kind === "audio",
        ),
      ).toHaveLength(2)
      expect(
        (
          await db.shortAttempt.findUniqueOrThrow({
            where: { id: admitted.attemptId },
          })
        ).status,
      ).toBe("SUCCEEDED")
    })
    it("does not let a duplicate runner's context failure terminate an owned live claim", async () => {
      const f = await fixture(),
        admitted = await f.admit(1)
      await f.finish(admitted.runId, undefined, {
        afterClaim: async () => {
          expect(
            await f.production(admitted.runId, "preflight-error", {
              diagnostic: "Duplicate runner lost context response",
            }),
          ).toMatchObject({
            recorded: true,
            run: {
              state: "READY",
              calls: expect.arrayContaining([
                expect.objectContaining({ state: "RUNNING" }),
              ]),
            },
          })
          expect(
            (
              await db.shortAttempt.findUniqueOrThrow({
                where: { id: admitted.attemptId },
              })
            ).status,
          ).toBe("QUEUED")
        },
      })
      expect(f.paid()).toBe(2)
      expect(
        (
          await db.shortAttempt.findUniqueOrThrow({
            where: { id: admitted.attemptId },
          })
        ).status,
      ).toBe("SUCCEEDED")
    })
    it("consumes ambiguous claims and blocks alternate keys/clients from blindly retrying paid work", async () => {
      const f = await fixture(),
        admitted = await f.admit(1),
        plan = (await readDelegatedNarrationPlan(db, admitted.runId))!
      const digest = studioHash(plan.segments[0]!.identity),
        key = `speech-${digest}`
      await expect(
        f.production(admitted.runId, "claim", {
          key: "unadmitted",
          inputDigest: "a".repeat(64),
          reserveMicros: 0,
        }),
      ).rejects.toThrow("INVALID")
      expect(
        await f.production(admitted.runId, "claim", {
          key,
          inputDigest: digest,
          reserveMicros: 0,
        }),
      ).toMatchObject({ execute: true })
      await f.production(admitted.runId, "finish", {
        key,
        state: "AMBIGUOUS",
        result: {
          assets: [],
          actualCostMicros: null,
          credits: null,
          requestId: null,
          elapsedMs: 1,
        },
      })
      expect(
        await f.production(admitted.runId, "claim", {
          key,
          inputDigest: digest,
          reserveMicros: 0,
        }),
      ).toMatchObject({ execute: false, call: { state: "AMBIGUOUS" } })
      await f.production(admitted.runId, "fail", {
        diagnostic: "Provider outcome needs reconciliation",
      })
      await expect(f.admit(1, randomUUID(), "codex")).rejects.toThrow(
        "reconciliation",
      )
      expect(f.paid()).toBe(0)
    })
  },
)
