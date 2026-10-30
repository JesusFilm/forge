import { createHash, randomUUID } from "node:crypto"
import { expect, it, vi } from "vitest"
import { studioAttemptResultSchema } from "@forge/studio-contracts"
import { studioHash } from "@forge/studio-server"
import {
  STUDIO_RENDER_PROFILE,
  STUDIO_RENDER_PROFILE_V2,
  STUDIO_RENDER_OUTPUT_PART_BYTES,
  studioRenderOutputPartSchema,
} from "@forge/studio-contracts/render"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { StudioRenderPoolAuth } from "./studio-render-pool-auth"
import { StudioRenderPoolGateway } from "./studio-render-pool-gateway"
import { StudioRenderRetentionError } from "./studio-render-runner"

const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex")
const ref = {
  assetId: "part-asset",
  versionId: "part-version",
  digest: "c".repeat(64),
}
const signal = () => new AbortController().signal
function fixture(profile = STUDIO_RENDER_PROFILE.id as string) {
  const auth = new StudioRenderPoolAuth({
    poolId: "pool",
    workerId: "worker",
    workerKey: "w".repeat(40),
    capabilityKey: "c".repeat(40),
  })
  const assignment = {
    poolId: "pool",
    workerId: "worker",
    dispatchId: randomUUID(),
    attemptId: "attempt",
    leaseId: randomUUID(),
    expiresAt: Date.now() + 60000,
  }
  const snapshot = {
    projectId: "project",
    revision: 21,
    inputHash: "a".repeat(64),
    executionProfile:
      profile === STUDIO_RENDER_PROFILE.id
        ? STUDIO_RENDER_PROFILE
        : STUDIO_RENDER_PROFILE_V2,
    document: {
      version: 1,
      title: "Fixture",
      language: "english",
      runtimeVersion: STUDIO_RUNTIME_VERSION,
      width: 320,
      height: 180,
      fps: 30,
      durationInFrames: 30,
      tracks: [],
      components: [],
      items: [],
    },
  }
  const result = studioAttemptResultSchema.parse({
    manifest: ref,
    assets: [ref],
    costMicros: null,
    diagnostic: "retained fixture",
  })
  const record = {
    attemptId: assignment.attemptId,
    leaseId: assignment.leaseId,
    status: "SUCCEEDED" as const,
    result,
  }
  const executions: Array<
    typeof record & { requestHash: string; admitted: boolean }
  > = []
  const call = vi.fn(async (command: string) => {
    if (command === "assigned")
      return { ...assignment, expiresAt: new Date(assignment.expiresAt) }
    if (command === "context") return { snapshot, executions }
    throw Error("Unexpected mutation")
  })
  const retainPart = vi.fn(async () => ref)
  const retainParts = vi.fn(async () => result)
  const retain = vi.fn(async () => result)
  const gateway = new StudioRenderPoolGateway(auth, {
    call,
    prepare: vi.fn(),
    upload: vi.fn(),
    retain,
    retainPart,
    retainParts,
  })
  const token = () => auth.issue(assignment, "a".repeat(64))
  const bytes = Buffer.from("part")
  const metadata = {
    index: 0,
    count: 1,
    byteSize: bytes.length,
    totalBytes: bytes.length,
    outputDigest: digest(bytes),
    retentionDeadlineMs: Date.now() + 40000,
  }
  const partRequest = { ...metadata, output: bytes.toString("base64") }
  return {
    auth,
    assignment,
    snapshot,
    result,
    record,
    executions,
    call,
    retainPart,
    retainParts,
    retain,
    gateway,
    token,
    bytes,
    metadata,
    partRequest,
  }
}

it("binds a canonical bounded part to the exact issued snapshot and delegates only its bytes", async () => {
  const f = fixture()
  expect(
    await f.gateway.retainPart(f.token(), f.partRequest, signal()),
  ).toEqual({ part: ref })
  expect(f.retainPart).toHaveBeenCalledExactlyOnceWith(
    f.snapshot,
    f.assignment,
    f.metadata,
    f.bytes,
    expect.any(AbortSignal),
  )
  expect(f.retain).not.toHaveBeenCalled()
})

it.each([
  { index: 1 },
  { count: 2 },
  { count: 9 },
  { byteSize: 3 },
  { totalBytes: 0 },
  { totalBytes: 134217729 },
  { outputDigest: "wrong" },
  { retentionDeadlineMs: 1 },
  { retentionDeadlineMs: Date.now() + 120000 },
  { output: "cGFydA==\n" },
  { output: "cGFydA" },
  { output: "!!!!" },
  { extra: true },
])(
  "refuses inconsistent part metadata or noncanonical encoding: %j",
  async (changed) => {
    const f = fixture()
    await expect(
      f.gateway.retainPart(
        f.token(),
        { ...f.partRequest, ...changed },
        signal(),
      ),
    ).rejects.toThrow()
    expect(f.retainPart).not.toHaveBeenCalled()
  },
)

it("rejects an oversized encoded part before calling storage", async () => {
  const f = fixture()
  await expect(
    f.gateway.retainPart(
      f.token(),
      {
        ...f.partRequest,
        output: "A".repeat(
          Math.ceil(STUDIO_RENDER_OUTPUT_PART_BYTES / 3) * 4 + 1,
        ),
      },
      signal(),
    ),
  ).rejects.toThrow()
  expect(f.retainPart).not.toHaveBeenCalled()
})

it("refuses missing authority, changed snapshot and legacy execution for part retention", async () => {
  const f = fixture()
  await expect(
    f.gateway.retainPart(null, f.partRequest, signal()),
  ).rejects.toThrow()
  f.snapshot.inputHash = "b".repeat(64)
  await expect(
    f.gateway.retainPart(f.token(), f.partRequest, signal()),
  ).rejects.toThrow()
  expect(f.retainPart).not.toHaveBeenCalled()
  const old = fixture(STUDIO_RENDER_PROFILE_V2.id)
  await expect(
    old.gateway.retainPart(old.token(), old.partRequest, signal()),
  ).rejects.toThrow()
  expect(old.retainPart).not.toHaveBeenCalled()
})

it("passes only bounded immutable references and codec proof to final assembly", async () => {
  const f = fixture()
  const proof = { fixture: "proof" }
  const envelope = await f.gateway.retain(
    f.token(),
    { status: "SUCCEEDED", parts: [ref], proof },
    signal(),
  )
  expect(f.retainParts).toHaveBeenCalledExactlyOnceWith(
    f.assignment,
    [ref],
    proof,
    expect.any(AbortSignal),
  )
  expect(f.retain).not.toHaveBeenCalled()
  expect(f.auth.settlement(envelope.settlement).record.result).toEqual(f.result)
})

it.each([
  { parts: [] },
  { parts: [ref, ref] },
  {
    parts: Array.from({ length: 9 }, (_, index) => ({
      ...ref,
      versionId: `part-${index}`,
    })),
  },
  { parts: [ref], output: "cGFydA==" },
])(
  "rejects ambiguous, duplicate or excessive final parts: %j",
  async (changed) => {
    const f = fixture()
    await expect(
      f.gateway.retain(
        f.token(),
        { status: "SUCCEEDED", proof: {}, ...changed },
        signal(),
      ),
    ).rejects.toThrow()
    expect(f.retainParts).not.toHaveBeenCalled()
  },
)

it("preserves partial retained assets when assembly reports failure", async () => {
  const f = fixture()
  f.retainParts.mockRejectedValueOnce(new StudioRenderRetentionError(f.result))
  const envelope = await f.gateway.retain(
    f.token(),
    { status: "SUCCEEDED", parts: [ref], proof: {} },
    signal(),
  )
  expect(f.auth.settlement(envelope.settlement).record).toMatchObject({
    status: "FAILED",
    result: f.result,
  })
})

it("refuses an aborted part or finalization without invoking storage", async () => {
  const f = fixture(),
    controller = new AbortController()
  controller.abort()
  await expect(
    f.gateway.retainPart(f.token(), f.partRequest, controller.signal),
  ).rejects.toThrow()
  await expect(
    f.gateway.retain(
      f.token(),
      { status: "SUCCEEDED", parts: [ref], proof: {} },
      controller.signal,
    ),
  ).rejects.toThrow()
  expect(f.retainPart).not.toHaveBeenCalled()
  expect(f.retainParts).not.toHaveBeenCalled()
})

it("recovers only an existing exact canonical receipt without calling any mutation", async () => {
  const f = fixture()
  f.executions.push({
    ...f.record,
    requestHash: studioHash(f.record),
    admitted: true,
  })
  const recovered = await f.gateway.receipt(f.token(), {}, signal())
  expect(recovered).toMatchObject({ receipt: { admitted: true } })
  expect(
    recovered &&
      "settlement" in recovered &&
      typeof recovered.settlement === "string" &&
      f.auth.settlement(recovered.settlement).record,
  ).toEqual(f.record)
  expect(
    f.call.mock.calls.every(([command]) =>
      ["assigned", "context"].includes(command),
    ),
  ).toBe(true)
  expect(f.retainPart).not.toHaveBeenCalled()
  expect(f.retainParts).not.toHaveBeenCalled()
  expect(f.retain).not.toHaveBeenCalled()
})

it("returns null for no canonical execution and ignores a different lease", async () => {
  const f = fixture()
  expect(await f.gateway.receipt(f.token(), {}, signal())).toBeNull()
  f.executions.push({
    ...f.record,
    leaseId: randomUUID(),
    requestHash: studioHash(f.record),
    admitted: true,
  })
  expect(await f.gateway.receipt(f.token(), {}, signal())).toBeNull()
})

it.each(["hash", "attempt"])(
  "refuses changed canonical execution %s during receipt recovery",
  async (changed) => {
    const f = fixture()
    const record =
      changed === "attempt"
        ? { ...f.record, attemptId: "other-attempt" }
        : f.record
    f.executions.push({
      ...record,
      requestHash: changed === "hash" ? "0".repeat(64) : studioHash(record),
      admitted: true,
    })
    await expect(f.gateway.receipt(f.token(), {}, signal())).rejects.toThrow()
  },
)

it("recovers committed historical receipts with fresh transport authority without renewing execution", async () => {
  const f = fixture()
  f.assignment.expiresAt = Date.now() - 60000
  f.executions.push({
    ...f.record,
    requestHash: studioHash(f.record),
    admitted: false,
  })
  expect(await f.gateway.receipt(f.token(), {}, signal())).toMatchObject({
    receipt: { admitted: false },
  })
  expect(
    f.call.mock.calls.every(([command]) => command !== "claim-assigned"),
  ).toBe(true)
})

it("enforces exact partition sizes at full-output boundaries", () => {
  for (const totalBytes of [
    1,
    STUDIO_RENDER_OUTPUT_PART_BYTES,
    STUDIO_RENDER_OUTPUT_PART_BYTES + 1,
    106963325,
    134217728,
  ]) {
    const count = Math.ceil(totalBytes / STUDIO_RENDER_OUTPUT_PART_BYTES)
    let sum = 0
    for (let index = 0; index < count; index++) {
      const byteSize = Math.min(
        STUDIO_RENDER_OUTPUT_PART_BYTES,
        totalBytes - index * STUDIO_RENDER_OUTPUT_PART_BYTES,
      )
      expect(
        studioRenderOutputPartSchema.parse({
          index,
          count,
          byteSize,
          totalBytes,
          outputDigest: "a".repeat(64),
          retentionDeadlineMs: Date.now() + 40000,
        }),
      ).toMatchObject({ index, count, byteSize })
      sum += byteSize
    }
    expect(sum).toBe(totalBytes)
  }
})

it("seals an incomplete normal Admin RPC result as failure while preserving its references", async () => {
  const f = fixture()
  const partial = studioAttemptResultSchema.parse({
    assets: [ref],
    costMicros: null,
    diagnostic: "Render retention incomplete; retained assets preserved",
  })
  f.retainParts.mockResolvedValueOnce(partial)
  const envelope = await f.gateway.retain(
    f.token(),
    { status: "SUCCEEDED", parts: [ref], proof: {} },
    signal(),
  )
  expect(f.auth.settlement(envelope.settlement).record).toEqual({
    ...f.record,
    status: "FAILED",
    result: partial,
  })
})
