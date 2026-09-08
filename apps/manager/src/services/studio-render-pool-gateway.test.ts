import { randomUUID } from "node:crypto"
import { expect, it, vi } from "vitest"
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { StudioRenderPoolAuth } from "./studio-render-pool-auth"
import { StudioRenderRetentionError } from "./studio-render-runner"
import { StudioRenderPoolGateway } from "./studio-render-pool-gateway"

const config = {
  poolId: "pool",
  workerId: "worker",
  workerKey: "w".repeat(40),
  capabilityKey: "c".repeat(40),
}
function fixture() {
  const auth = new StudioRenderPoolAuth(config)
  const assignment = {
    poolId: "pool",
    workerId: "worker",
    dispatchId: randomUUID(),
    attemptId: "attempt",
    leaseId: randomUUID(),
    expiresAt: Date.now() + 1200000,
  }
  const snapshot = {
    projectId: "project",
    revision: 1,
    inputHash: "a".repeat(64),
    executionProfile: STUDIO_RENDER_PROFILE,
    document: {
      version: 1,
      title: "Fixture",
      language: "english",
      runtimeVersion: STUDIO_RUNTIME_VERSION,
      width: 320,
      height: 180,
      fps: 30,
      durationInFrames: 30,
      packRevisionIds: [],
      tracks: [],
      components: [],
      items: [],
    },
  }
  let owns = true
  let eligible = true
  const call = vi.fn(
    async (
      command: string,
      _input: unknown,
      _signal?: AbortSignal,
    ): Promise<unknown> => {
      if (command === "assigned")
        return { ...assignment, expiresAt: new Date(assignment.expiresAt) }
      if (command === "claim-assigned")
        return { execute: eligible && owns, leaseId: assignment.leaseId }
      if (command === "context") return { snapshot }
      if (command === "owns") return owns
      throw new Error("Unexpected canonical operation")
    },
  )
  const prepare = vi.fn(async () => ({ input: {}, files: [] }))
  const retain = vi.fn(async () => ({
    assets: [],
    costMicros: null,
    diagnostic: "retained fixture",
  }))
  const gateway = new StudioRenderPoolGateway(auth, { call, prepare, retain })
  const token = auth.issue(assignment, snapshot.inputHash)
  return {
    auth,
    gateway,
    call,
    prepare,
    retain,
    assignment,
    snapshot,
    token,
    invalidate: () => {
      eligible = false
    },
    lose: () => {
      owns = false
    },
  }
}
it("derives claim identity from dedicated worker authentication and returns only an exact-lease capability", async () => {
  const f = fixture()
  await expect(
    f.gateway.claim(
      "Bearer generic-key",
      { dispatchId: f.assignment.dispatchId },
      new AbortController().signal,
    ),
  ).rejects.toThrow("authorization refused")
  expect(f.call).not.toHaveBeenCalled()
  const result = await f.gateway.claim(
    `Bearer ${config.workerKey}`,
    { dispatchId: f.assignment.dispatchId },
    new AbortController().signal,
  )
  expect(result).toMatchObject({ execute: true, assignment: f.assignment })
  expect(f.auth.lease(result.capability)).toMatchObject({
    assignment: f.assignment,
    inputHash: f.snapshot.inputHash,
  })
  await expect(
    f.gateway.claim(
      `Bearer ${config.workerKey}`,
      { dispatchId: f.assignment.dispatchId, poolId: "other" },
      new AbortController().signal,
    ),
  ).rejects.toThrow()
})
it("refuses worker-key access to input and refuses changed canonical lease/hash before materialization", async () => {
  const f = fixture()
  await expect(
    f.gateway.input(config.workerKey, new AbortController().signal),
  ).rejects.toThrow("authorization refused")
  f.snapshot.inputHash = "b".repeat(64)
  await expect(
    f.gateway.input(f.token, new AbortController().signal),
  ).rejects.toThrow("binding")
  expect(f.prepare).not.toHaveBeenCalled()
})
it("rechecks ownership after preparation; cancellation during downloads exposes no input", async () => {
  const f = fixture()
  f.prepare.mockImplementationOnce(async () => {
    f.lose()
    return { input: {}, files: [] }
  })
  await expect(
    f.gateway.input(f.token, new AbortController().signal),
  ).rejects.toThrow("lease")
  expect(
    f.call.mock.calls.filter(([command]) => command === "claim-assigned"),
  ).toHaveLength(2)
  await expect(
    f.gateway.owns(f.token, new AbortController().signal),
  ).resolves.toBe(false)
})
it("preserves an ineligible historical claim capability for reconciliation without preparing inputs", async () => {
  const f = fixture()
  f.lose()
  const claim = await f.gateway.claim(
    `Bearer ${config.workerKey}`,
    { dispatchId: f.assignment.dispatchId },
    new AbortController().signal,
  )
  expect(claim.execute).toBe(false)
  expect(f.auth.lease(claim.capability).assignment).toEqual(f.assignment)
  await expect(
    f.gateway.input(claim.capability, new AbortController().signal),
  ).rejects.toThrow("lease")
  expect(f.prepare).not.toHaveBeenCalled()
})

it("seals partial retention after timeout and submits the exact record despite lost ownership", async () => {
  const f = fixture()
  f.lose()
  const partial = {
    assets: [
      { assetId: "asset", versionId: "version", digest: "b".repeat(64) },
    ],
    costMicros: null,
    diagnostic: "partial",
  }
  f.retain.mockRejectedValueOnce(new StudioRenderRetentionError(partial))
  const sealed = await f.gateway.retain(
    f.token,
    {
      status: "SUCCEEDED",
      output: Buffer.from("fixture").toString("base64"),
      proof: {},
    },
    new AbortController().signal,
  )
  const record = f.auth.settlement(sealed.settlement).record
  expect(record).toEqual({
    attemptId: f.assignment.attemptId,
    leaseId: f.assignment.leaseId,
    status: "FAILED",
    result: partial,
  })
  f.call.mockImplementation(async (command) => {
    if (command === "assigned")
      return { ...f.assignment, expiresAt: new Date(f.assignment.expiresAt) }
    if (command === "context") return { snapshot: f.snapshot }
    if (command === "finish") return { admitted: false }
    throw new Error("Unexpected operation")
  })
  await expect(
    f.gateway.finish(f.token, sealed, new AbortController().signal),
  ).resolves.toEqual({ admitted: false })
  await expect(
    f.gateway.finish(f.token, sealed, new AbortController().signal),
  ).resolves.toEqual({ admitted: false })
  expect(
    f.call.mock.calls.filter(([command]) => command === "finish"),
  ).toHaveLength(2)
  expect(f.retain).toHaveBeenCalledOnce()
})
it("refuses client-authored terminal assets and cross-lease signed settlement", async () => {
  const f = fixture()
  await expect(
    f.gateway.finish(
      f.token,
      { status: "SUCCEEDED", result: { assets: [] } },
      new AbortController().signal,
    ),
  ).rejects.toThrow()
  const other = { ...f.assignment, leaseId: randomUUID() }
  const settlement = f.auth.sealSettlement(other, f.snapshot.inputHash, {
    attemptId: other.attemptId,
    leaseId: other.leaseId,
    status: "FAILED",
    result: { assets: [], costMicros: null },
  })
  await expect(
    f.gateway.finish(f.token, { settlement }, new AbortController().signal),
  ).rejects.toThrow("binding")
  expect(f.call).not.toHaveBeenCalled()
})

it("rejects terminalized or edited assignments even when the older job-only ownership predicate remains true", async () => {
  const f = fixture()
  f.invalidate()
  await expect(
    f.gateway.owns(f.token, new AbortController().signal),
  ).resolves.toBe(false)
  await expect(
    f.gateway.input(f.token, new AbortController().signal),
  ).rejects.toThrow("lease")
  expect(f.prepare).not.toHaveBeenCalled()
})
it("reads the exact accepted receipt after a recording window, without another canonical mutation", async () => {
  const f = fixture()
  const record = {
    attemptId: f.assignment.attemptId,
    leaseId: f.assignment.leaseId,
    status: "FAILED" as const,
    result: { assets: [], costMicros: null },
  }
  const { studioHash } = await import("@forge/studio-server")
  const envelope = {
    settlement: f.auth.sealSettlement(
      f.assignment,
      f.snapshot.inputHash,
      record,
    ),
  }
  f.call.mockImplementation(async (command) => {
    if (command === "assigned")
      return { ...f.assignment, expiresAt: new Date(f.assignment.expiresAt) }
    if (command === "context")
      return {
        snapshot: f.snapshot,
        executions: [
          {
            leaseId: record.leaseId,
            requestHash: studioHash(record),
            admitted: false,
          },
        ],
      }
    throw new Error("No mutation permitted")
  })
  await expect(
    f.gateway.receipt(f.token, envelope, new AbortController().signal),
  ).resolves.toEqual({ admitted: false })
  expect(
    f.call.mock.calls.every(([command]) =>
      ["assigned", "context"].includes(command),
    ),
  ).toBe(true)
})
