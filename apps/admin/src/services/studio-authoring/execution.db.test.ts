import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { StudioExecutionService } from "./execution"
import { StudioExperimentService } from "./experiments"
import { StudioAssetService } from "./assets"
import { executeStudioProduction } from "./production-rpc"
const url = env.STUDIO_TEST_DATABASE_URL
const human = {
  id: "execution-operator",
  role: "ADMIN" as const,
  studioAuthority: "interactive" as const,
}
const worker = { id: null, role: "MANAGER_BACKEND" as const }
class FixtureError extends Error {}
;(url ? describe : describe.skip)("Studio paid execution ledger", () => {
  let db: PrismaClient
  beforeAll(() => {
    if (url !== "postgresql://tataihono@127.0.0.1:55458/forge_studio_458_test")
      throw new FixtureError("Owned DB only")
    db = new PrismaClient({ datasources: { db: { url } } })
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  it("pages retained experiment runs without losing runs with equal timestamps", async () => {
    const service = new StudioExecutionService(db),
      ids: string[] = [],
      createdAt = new Date(Date.now() + 3600000)
    for (let index = 0; index < 22; index++) {
      const experiment = await new StudioExperimentService(db).request(human, {
        idempotencyKey: randomUUID(),
        kind: "music",
        provider: "elevenlabs",
        model: "music_v1",
        language: "en",
        prompt: "Pagination fixture",
        settings: { lengthMs: 10000 },
        candidateCount: 1,
        estimate: {
          currency: "USD",
          amountMicros: 100,
          basis: "Test-only rates",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        maxCostMicros: 100,
        confirmed: true,
      })
      // Fixture insertion fixes the admission timestamp without bypassing immutable UPDATE guards.
      ids.push(
        (
          await db.studioProductionRun.create({
            data: {
              experimentId: experiment.id,
              actor: { kind: "human", id: human.id, authority: "interactive" },
              maxCostMicros: 100,
              createdAt,
            },
          })
        ).id,
      )
    }
    const first = await service.list(human, { kind: "experiment" })
    expect(first).toHaveLength(20)
    expect(first.every((run) => ids.includes(run.id))).toBe(true)
    const last = first.at(-1)!
    const second = await service.list(human, {
      kind: "experiment",
      before: { createdAt: last.createdAt.toISOString(), id: last.id },
    })
    expect(
      second.some((run) => first.some((prior) => prior.id === run.id)),
    ).toBe(false)
    expect(
      [...first, ...second].filter((run) => ids.includes(run.id)),
    ).toHaveLength(22)
  })
  it("restricts production capabilities and retains preflight failure without a paid reservation", async () => {
    await db.user.upsert({
      where: { id: human.id },
      create: {
        id: human.id,
        name: "Execution fixture operator",
        email: "execution-operator@studio458.test",
        role: "ADMIN",
        managerMembership: { create: { role: "OPERATOR" } },
      },
      update: {},
    })
    const experiment = await new StudioExperimentService(db).request(human, {
      idempotencyKey: randomUUID(),
      kind: "music",
      provider: "elevenlabs",
      model: "music_v1",
      language: "en",
      prompt: "Quiet strings",
      settings: { lengthMs: 10000 },
      candidateCount: 1,
      estimate: {
        currency: "USD",
        amountMicros: 100,
        basis: "Test-only rates",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      maxCostMicros: 100,
      confirmed: true,
    })
    const service = new StudioExecutionService(db),
      run = await service.admit(human, {
        experimentId: experiment.id,
        maxCostMicros: 100,
      })
    const caller = {
      sub: human.id,
      authority: "delegated" as const,
      clientId: "studio-production",
      scopes: ["studio:production:execute"],
    }
    const request = {
      action: "production",
      runId: run.id,
      command: "preflight-error",
      input: {
        diagnostic: "Verified account rate expired; no provider dispatched",
      },
    }
    for (const denied of [
      { ...caller, clientId: "studio-hosted" },
      { ...caller, clientId: "studio-planner" },
      { ...caller, authority: "interactive" as const },
      { ...caller, scopes: [] },
    ])
      await expect(
        executeStudioProduction(db, denied, request),
      ).rejects.toThrow("Trusted production execution")
    await Promise.all([
      executeStudioProduction(db, caller, request),
      executeStudioProduction(db, caller, request),
    ])
    const result = await service.read(human, run.id)
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]).toMatchObject({
      state: "FAILED",
      reserveMicros: 0,
      result: {
        actualCostMicros: 0,
        requestId: null,
        providerMetadata: { phase: "preflight", providerDispatched: false },
      },
    })
    await db.managerMembership.update({
      where: { userId: human.id },
      data: { revokedAt: new Date() },
    })
    try {
      await expect(
        executeStudioProduction(db, caller, {
          ...request,
          command: "context",
          input: {},
        }),
      ).rejects.toThrow()
    } finally {
      await db.managerMembership.update({
        where: { userId: human.id },
        data: { revokedAt: null },
      })
    }
  })
  it("claims one paid call across concurrent runners and retains its reservation after restart", async () => {
    const experiment = await new StudioExperimentService(db).request(human, {
      idempotencyKey: randomUUID(),
      kind: "music",
      provider: "elevenlabs",
      model: "music_v1",
      language: "en",
      prompt: "Gentle instrumental",
      settings: { lengthMs: 10000 },
      candidateCount: 2,
      estimate: {
        currency: "USD",
        amountMicros: 200,
        basis: "test rate",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      maxCostMicros: 200,
      confirmed: true,
    })
    const service = new StudioExecutionService(db)
    const run = await service.admit(human, {
      experimentId: experiment.id,
      maxCostMicros: 200,
    })
    const input = {
      runId: run.id,
      key: "candidate-1",
      inputDigest: "a".repeat(64),
      reserveMicros: 150,
    }
    const results = await Promise.all([
      service.claim(worker, input),
      new StudioExecutionService(db).claim(worker, input),
    ])
    expect(results.map((r) => r.execute).sort()).toEqual([false, true])
    expect(
      (await new StudioExecutionService(db).claim(worker, input)).execute,
    ).toBe(false)
    await expect(
      service.claim(worker, { ...input, key: "candidate-2" }),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" })
    expect((await service.read(human, run.id)).calls[0].state).toBe("RUNNING")
  })
  it("cancels future dispatch but retains a late provider result and an overrun", async () => {
    const experiment = await new StudioExperimentService(db).request(human, {
      idempotencyKey: randomUUID(),
      kind: "music",
      provider: "elevenlabs",
      model: "music_v1",
      language: "en",
      prompt: "Gentle instrumental",
      settings: { lengthMs: 10000 },
      candidateCount: 2,
      estimate: {
        currency: "USD",
        amountMicros: 200,
        basis: "test rate",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      maxCostMicros: 200,
      confirmed: true,
    })
    const service = new StudioExecutionService(db)
    const run = await service.admit(human, {
      experimentId: experiment.id,
      maxCostMicros: 200,
    })
    const input = {
      runId: run.id,
      key: "candidate-1",
      inputDigest: "b".repeat(64),
      reserveMicros: 100,
    }
    await service.claim(worker, input)
    await service.cancel(human, run.id)
    await expect(
      service.claim(worker, { ...input, key: "candidate-2" }),
    ).rejects.toMatchObject({ code: "CANCELLED" })
    const result = {
      assets: [],
      actualCostMicros: 100000001,
      credits: null,
      requestId: "late-request",
      elapsedMs: 500,
    }
    await service.finish(worker, {
      runId: run.id,
      key: input.key,
      state: "COMPLETED",
      result,
    })
    await service.finish(worker, {
      runId: run.id,
      key: input.key,
      state: "COMPLETED",
      result,
    })
    const saved = await service.read(human, run.id)
    expect(saved.state).toBe("CANCELLED")
    expect(saved.calls[0].result).toEqual(result)
    expect((await service.claim(worker, input)).execute).toBe(false)
  })

  it("retains unknown experiment charges as unknown rather than zero or within limits", async () => {
    const experiments = new StudioExperimentService(db)
    const spec = {
      idempotencyKey: randomUUID(),
      kind: "music",
      provider: "elevenlabs",
      model: "music_v1",
      language: "en",
      prompt: "Gentle instrumental",
      settings: { lengthMs: 10000 },
      candidateCount: 1,
      estimate: {
        currency: "USD",
        amountMicros: 200,
        basis: "test rate",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      maxCostMicros: 200,
      confirmed: true,
    }
    const experiment = await experiments.request(human, spec)
    const asset = await new StudioAssetService(db).register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "music.mp3",
        mimeType: "audio/mpeg",
        role: "music",
        provenance: {
          status: "recorded",
          recorded: {
            experimentId: experiment.id,
            provider: spec.provider,
            model: spec.model,
            language: spec.language,
            prompt: spec.prompt,
            settings: spec.settings,
          },
        },
      },
      Buffer.from("fixture music"),
      "LOCAL",
    )
    const candidate = {
      experimentId: experiment.id,
      candidateKey: randomUUID(),
      asset: asset.reference,
      providerRequestId: "request",
      actualCostMicros: null,
    }
    await experiments.addCandidate(worker, candidate)
    await experiments.addCandidate(worker, candidate)
    const saved = await experiments.read(human, experiment.id)
    expect(saved.outcome).toMatchObject({
      status: "COST_UNKNOWN",
      actualCostMicros: null,
    })
    expect(saved.candidates).toHaveLength(1)
    expect(saved.candidates[0].actualCostMicros).toBeNull()
    const selection = {
      experimentId: experiment.id,
      candidateKey: candidate.candidateKey,
      idempotencyKey: randomUUID(),
    }
    await experiments.select(human, selection)
    await experiments.select(human, selection)
    expect(
      (await experiments.read(human, experiment.id)).selection,
    ).toMatchObject({ candidateKey: candidate.candidateKey })
    await expect(
      experiments.select(
        { ...human, studioAuthority: "delegated" },
        { ...selection, idempotencyKey: randomUUID() },
      ),
    ).rejects.toThrow()
  })
})
