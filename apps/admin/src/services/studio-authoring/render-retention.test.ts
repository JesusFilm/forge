import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import {
  studioDocumentSchema,
  studioAssetReferenceSchema,
  studioAttemptResultSchema,
} from "@forge/studio-contracts"
import {
  studioAssetVersionSchema,
  type ShortAssetVersion,
} from "@forge/studio-contracts/assets"
import {
  STUDIO_CODEC_VERIFIER_VERSION,
  STUDIO_RENDER_PROFILE,
  STUDIO_RENDER_PROFILE_V2,
  STUDIO_RENDER_OUTPUT_PART_BYTES,
} from "@forge/studio-contracts/render"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import {
  StudioAssetService,
  byteDigest,
  readVerifiedStudioAsset,
} from "./assets"
import { studioHash } from "./state"
import { StudioRenderRetention } from "./render-retention"
import { executeStudioRender } from "./render-rpc"

vi.mock("./assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assets")>()),
  readVerifiedStudioAsset: vi.fn(),
}))
const worker = { id: null, role: "MANAGER_BACKEND" as const }
const db = new PrismaClient()
const document = studioDocumentSchema.parse({
  version: 1,
  title: "Bounded retention",
  language: "english",
  runtimeVersion: STUDIO_RUNTIME_VERSION,
  width: 320,
  height: 180,
  fps: 30,
  durationInFrames: 30,
  tracks: [],
  items: [],
  components: [],
  packRevisionIds: [],
})
const attemptId = "retention-attempt",
  leaseId = randomUUID(),
  inputHash = "a".repeat(64)
const snapshot = {
  projectId: "retention-project",
  revision: 1,
  inputHash,
  document,
  executionProfile: STUDIO_RENDER_PROFILE,
}
const recorded = {
  attemptId,
  leaseId,
  profileId: STUDIO_RENDER_PROFILE.id,
  inputHash,
}
const retained = new Map<string, ShortAssetVersion>()
let parts: ShortAssetVersion[],
  payload: Buffer<ArrayBuffer>,
  reads: MockInstance<StudioAssetService["read"]>,
  registers: MockInstance<StudioAssetService["register"]>
function proof() {
  return {
    version: 1,
    verifierVersion: STUDIO_CODEC_VERIFIER_VERSION,
    outputDigest: byteDigest(payload),
    decoded: true,
    video: {
      codec: "h264",
      width: 320,
      height: 180,
      fps: 30,
      frames: 30,
      durationMs: 1000,
    },
    audio: { codec: "aac", sampleRate: 48000, channels: 2, durationMs: 1000 },
  }
}
function input() {
  return {
    attemptId,
    leaseId,
    parts: parts.map((part) => part.reference),
    proof: proof(),
  }
}
function job() {
  return Object.assign(
    {
      attemptId,
      snapshot: structuredClone(snapshot),
      state: "RUNNING",
      generation: 1,
      leaseId,
      leaseExpiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      attempt: {
        kind: "RENDER",
        projectId: snapshot.projectId,
        baseRevision: 1,
        inputHash,
      },
    },
  )
}
beforeEach(() => {
  retained.clear()
  payload = Buffer.alloc(STUDIO_RENDER_OUTPUT_PART_BYTES + 11, 41)
  const retentionDeadlineMs = Date.now() + 40000
  parts = Array.from({ length: 2 }, (_, index) => {
    const bytes = payload.subarray(
      index * STUDIO_RENDER_OUTPUT_PART_BYTES,
      (index + 1) * STUDIO_RENDER_OUTPUT_PART_BYTES,
    )
    return studioAssetVersionSchema.parse({
      reference: {
        assetId: `part-${index}`,
        versionId: `part-version-${index}`,
        digest: byteDigest(bytes),
      },
      mediaAssetId: `media-${index}`,
      role: "archive",
      filename: `${attemptId}-part-${index}.bin`,
      mimeType: "application/octet-stream",
      byteSize: bytes.length,
      provenance: {
        status: "recorded",
        recorded: {
          ...recorded,
          outputDigest: byteDigest(payload),
          outputBytes: payload.length,
          partIndex: index,
          partCount: 2,
          retentionDeadlineMs,
        },
      },
      actor: { kind: "service", id: "manager_backend" },
      narration: null,
      voice: null,
    })
  })
  vi.spyOn(db.shortRenderLease, "findUnique").mockResolvedValue({
    attemptId,
    leaseId,
    generation: 1,
    expiresAt: new Date(),
    createdAt: new Date(),
    poolId: null,
    workerId: null,
    dispatchId: null,
  })
  vi.spyOn(db.shortRenderJob, "findUnique").mockResolvedValue(job())
  reads = vi
    .spyOn(StudioAssetService.prototype, "read")
    .mockImplementation(async (_user, raw) => {
      const reference = studioAssetReferenceSchema.parse(raw)
      const part = parts.find(
        (part) => studioHash(part.reference) === studioHash(reference),
      )
      if (!part) throw new Error("Unknown immutable reference")
      return part
    })
  vi.mocked(readVerifiedStudioAsset).mockImplementation(
    async (_db, reference) => {
      const index = parts.findIndex(
        (part) => studioHash(part.reference) === studioHash(reference),
      )
      if (index < 0) throw new Error("Unknown bytes")
      return payload.subarray(
        index * STUDIO_RENDER_OUTPUT_PART_BYTES,
        (index + 1) * STUDIO_RENDER_OUTPUT_PART_BYTES,
      )
    },
  )
  registers = vi
    .spyOn(StudioAssetService.prototype, "register")
    .mockImplementation(async (_user, raw, bytes) => {
      const { studioRegisterAssetSchema } =
        await import("@forge/studio-contracts/assets")
      const metadata = studioRegisterAssetSchema.parse(raw)
      const prior = retained.get(metadata.idempotencyKey)
      if (prior) return prior
      const digest = byteDigest(bytes)
      const asset = studioAssetVersionSchema.parse({
        reference: { assetId: randomUUID(), versionId: randomUUID(), digest },
        mediaAssetId: randomUUID(),
        ...metadata,
        byteSize: bytes.length,
        actor: { kind: "service", id: "manager_backend" },
        narration: null,
        voice: null,
      })
      retained.set(metadata.idempotencyKey, asset)
      return asset
    })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(readVerifiedStudioAsset).mockReset()
})

describe("bounded Admin render retention", () => {
  it("assembles exact ordered bytes internally, registers the normal manifest and retries identically", async () => {
    const service = new StudioRenderRetention(db)
    const result = await service.retain(worker, input())
    expect(result.assets).toHaveLength(3)
    expect(result.manifest).toEqual(result.assets[2])
    expect(Buffer.from(registers.mock.calls[0][2]).equals(payload)).toBe(true)
    expect(
      JSON.parse(Buffer.from(registers.mock.calls[2][2]).toString()),
    ).toMatchObject({
      projectId: snapshot.projectId,
      revision: 1,
      inputHash,
      output: result.assets[0],
      verification: { outputDigest: byteDigest(payload), status: "verified" },
    })
    for (const call of registers.mock.calls)
      expect(call[1]).toMatchObject({ provenance: { recorded } })
    expect(registers.mock.calls[1][1]).toMatchObject({
      dependencies: [result.assets[0]],
    })
    expect(registers.mock.calls[2][1]).toMatchObject({
      dependencies: result.assets.slice(0, 2),
    })
    expect(await service.retain(worker, input())).toEqual(result)
    expect(retained.size).toBe(3)
    expect(
      vi
        .mocked(readVerifiedStudioAsset)
        .mock.calls.every(
          (call) => call[2] === STUDIO_RENDER_OUTPUT_PART_BYTES,
        ),
    ).toBe(true)
  })

  it.each([
    ["attemptId", "another-attempt"],
    ["leaseId", randomUUID()],
    ["inputHash", "b".repeat(64)],
    ["profileId", STUDIO_RENDER_PROFILE_V2.id],
    ["partIndex", 1],
    ["partCount", 1],
    ["retentionDeadlineMs", 4000000000001],
    ["outputBytes", STUDIO_RENDER_PROFILE.outputBytes + 1],
    ["outputDigest", "b".repeat(64)],
  ])(
    "rejects mismatched part provenance %s before any byte reads or registration",
    async (field, value) => {
      parts[0].provenance.recorded[field] = value
      await expect(
        new StudioRenderRetention(db).retain(worker, input()),
      ).rejects.toThrow()
      expect(readVerifiedStudioAsset).not.toHaveBeenCalled()
      expect(registers).not.toHaveBeenCalled()
    },
  )
  it.each(["reordered", "duplicate", "missing", "too-many"])(
    "rejects %s references",
    async (kind) => {
      const request = input()
      if (kind === "reordered") request.parts.reverse()
      if (kind === "duplicate") request.parts[1] = request.parts[0]
      if (kind === "missing") request.parts.pop()
      if (kind === "too-many")
        request.parts = Array.from({ length: 9 }, () => parts[0].reference)
      await expect(
        new StudioRenderRetention(db).retain(worker, request),
      ).rejects.toThrow()
      expect(registers).not.toHaveBeenCalled()
    },
  )
  it.each(["role", "mime", "filename", "producer", "size", "zero", "unknown"])(
    "rejects invalid archive %s",
    async (kind) => {
      if (kind === "role") parts[0].role = "render"
      if (kind === "mime") parts[0].mimeType = "video/mp4"
      if (kind === "filename") parts[0].filename = "other.bin"
      if (kind === "producer")
        parts[0].actor = { kind: "service", id: "system" }
      if (kind === "size") parts[0].byteSize--
      if (kind === "zero") parts[0].byteSize = 0
      if (kind === "unknown") parts[0].provenance.status = "unknown"
      await expect(
        new StudioRenderRetention(db).retain(worker, input()),
      ).rejects.toThrow()
      expect(registers).not.toHaveBeenCalled()
    },
  )
  it.each(["length", "digest"])(
    "rejects stored byte %s mismatch",
    async (kind) => {
      vi.mocked(readVerifiedStudioAsset).mockResolvedValueOnce(
        kind === "length"
          ? Buffer.alloc(1)
          : Buffer.alloc(STUDIO_RENDER_OUTPUT_PART_BYTES, 0),
      )
      await expect(
        new StudioRenderRetention(db).retain(worker, input()),
      ).rejects.toThrow("INVALID")
      expect(registers).not.toHaveBeenCalled()
    },
  )
  it.each(["width", "height", "fps", "frames", "durationMs"])(
    "rejects a proof with different video %s",
    async (field) => {
      const request = input()
      request.proof.video = { ...request.proof.video, [field]: 777 }
      await expect(
        new StudioRenderRetention(db).retain(worker, request),
      ).rejects.toThrow()
      expect(registers).not.toHaveBeenCalled()
    },
  )
  it("rejects incomplete decode/audio evidence and unissued or unsupported snapshots", async () => {
    for (const proof of [
      { ...input().proof, decoded: false },
      { ...input().proof, audio: { ...input().proof.audio, durationMs: 10 } },
    ]) {
      await expect(
        new StudioRenderRetention(db).retain(worker, { ...input(), proof }),
      ).rejects.toThrow()
    }
    vi.mocked(db.shortRenderLease.findUnique).mockResolvedValueOnce(null)
    await expect(
      new StudioRenderRetention(db).retain(worker, input()),
    ).rejects.toThrow("INVALID")
    const historical = {
      ...job(),
      snapshot: { ...snapshot, executionProfile: STUDIO_RENDER_PROFILE_V2 },
    }
    vi.mocked(db.shortRenderJob.findUnique).mockResolvedValueOnce(historical)
    await expect(
      new StudioRenderRetention(db).retain(worker, input()),
    ).rejects.toThrow("INVALID")
    expect(registers).not.toHaveBeenCalled()
  })
  it("preserves partial references and retries after a committed registration loses its response", async () => {
    const register = registers.getMockImplementation()!
    registers
      .mockImplementationOnce(register)
      .mockRejectedValueOnce(new Error("codec storage unavailable"))
    const partial = await new StudioRenderRetention(db).retain(worker, input())
    expect(partial.assets).toHaveLength(1)
    expect(partial.manifest).toBeUndefined()
    const result = await new StudioRenderRetention(db).retain(worker, input())
    expect(result.assets[0]).toEqual(partial.assets[0])
    retained.clear()
    registers.mockImplementationOnce(async (...args) => {
      await register(...args)
      throw new Error("committed registration response lost")
    })
    expect(
      await new StudioRenderRetention(db).retain(worker, input()),
    ).toMatchObject({ assets: [] })
    expect(retained.size).toBe(1)
    const committed = [...retained.values()][0].reference
    const retried = await new StudioRenderRetention(db).retain(worker, input())
    expect(retried.assets[0]).toEqual(committed)
    expect(await new StudioRenderRetention(db).retain(worker, input())).toEqual(
      retried,
    )
    expect(retained.size).toBe(3)
  })
  it("refuses concurrent assemblies across service instances and holds the slot through an aborted pending read", async () => {
    let release!: (bytes: Buffer<ArrayBuffer>) => void
    let started!: () => void
    const reading = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.mocked(readVerifiedStudioAsset).mockImplementationOnce(() => {
      started()
      return new Promise<Buffer<ArrayBuffer>>((resolve) => {
        release = resolve
      })
    })
    const controller = new AbortController()
    const first = new StudioRenderRetention(db).retain(
      worker,
      input(),
      controller.signal,
    )
    const rejected = expect(first).rejects.toThrow()
    await reading
    await expect(
      new StudioRenderRetention(db).retain(worker, input()),
    ).rejects.toThrow("PROJECT_BUSY")
    controller.abort()
    await expect(
      new StudioRenderRetention(db).retain(worker, input()),
    ).rejects.toThrow("PROJECT_BUSY")
    release(payload.subarray(0, STUDIO_RENDER_OUTPUT_PART_BYTES))
    await rejected
    expect(registers).not.toHaveBeenCalled()
    expect(
      (await new StudioRenderRetention(db).retain(worker, input())).manifest,
    ).toBeDefined()
  })
  it("checks cancellation before reads and after storage returns, without registering output", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new StudioRenderRetention(db).retain(worker, input(), controller.signal),
    ).rejects.toThrow()
    expect(reads).not.toHaveBeenCalled()
    const during = new AbortController()
    vi.mocked(readVerifiedStudioAsset).mockImplementationOnce(async () => {
      during.abort()
      return payload.subarray(0, STUDIO_RENDER_OUTPUT_PART_BYTES)
    })
    await expect(
      new StudioRenderRetention(db).retain(worker, input(), during.signal),
    ).rejects.toThrow()
    expect(registers).not.toHaveBeenCalled()
  })
  it("rejects an expired absolute deadline before allocating or reading bytes", async () => {
    for (const part of parts) part.provenance.recorded.retentionDeadlineMs = 1
    await expect(
      new StudioRenderRetention(db).retain(worker, input()),
    ).rejects.toThrow("INVALID")
    expect(readVerifiedStudioAsset).not.toHaveBeenCalled()
    expect(registers).not.toHaveBeenCalled()
  })
  it("checks the absolute deadline after a read returns before registering", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const now = Date.now()
      for (const part of parts)
        part.provenance.recorded.retentionDeadlineMs = now + 40000
      vi.mocked(readVerifiedStudioAsset).mockImplementationOnce(async () => {
        vi.setSystemTime(now + 40000)
        return payload.subarray(0, STUDIO_RENDER_OUTPUT_PART_BYTES)
      })
      await expect(
        new StudioRenderRetention(db).retain(worker, input()),
      ).rejects.toMatchObject({ name: "TimeoutError" })
      expect(registers).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it("aborts a pending storage read at the part deadline without a disconnect", async () => {
    const deadlineMs = Date.now() + 250
    for (const part of parts)
      part.provenance.recorded.retentionDeadlineMs = deadlineMs
    vi.mocked(readVerifiedStudioAsset).mockImplementationOnce(
      async (_db, _ref, _limit, signal) => {
        if (!signal) throw new TypeError("Retention read signal required")
        signal.throwIfAborted()
        return new Promise<Buffer<ArrayBuffer>>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
      },
    )
    await expect(
      new StudioRenderRetention(db).retain(worker, input()),
    ).rejects.toMatchObject({ name: "TimeoutError" })
    expect(registers).not.toHaveBeenCalled()
  })
  it("retains late/cancelled issued artifacts without finishing or reviving the attempt", async () => {
    vi.mocked(db.shortRenderJob.findUnique).mockResolvedValueOnce({
      ...job(),
      state: "CANCELLED",
      leaseExpiresAt: new Date(0),
    })
    const finish = vi.spyOn(db.shortRenderExecution, "create")
    expect(
      (await new StudioRenderRetention(db).retain(worker, input())).manifest,
    ).toBeDefined()
    expect(finish).not.toHaveBeenCalled()
  })
  it("exposes retention only to the exact trusted worker RPC authority", async () => {
    const caller = {
      sub: "shorts-render-worker",
      authority: "delegated" as const,
      clientId: "shorts-render",
      scopes: ["shorts:render:execute"],
    }
    for (const untrusted of [
      { ...caller, authority: "interactive" as const },
      { ...caller, sub: "other" },
      { ...caller, clientId: "shorts-hosted" },
      { ...caller, scopes: [] },
    ]) {
      await expect(
        executeStudioRender(db, untrusted, {
          action: "render-worker",
          command: "retain-output",
          input: input(),
        }),
      ).rejects.toThrow("Trusted render execution required")
    }
    await expect(
      new StudioRenderRetention(db).retain(
        { id: "operator", role: "ADMIN", studioAuthority: "interactive" },
        input(),
      ),
    ).rejects.toThrow("Trusted render worker required")
    await expect(
      new StudioRenderRetention(db).retain(
        { id: null, role: "SYSTEM" },
        input(),
      ),
    ).rejects.toThrow("Trusted render worker required")
    const result = studioAttemptResultSchema.parse(
      await executeStudioRender(db, caller, {
        action: "render-worker",
        command: "retain-output",
        input: input(),
      }),
    )
    expect(result.manifest).toBeDefined()
  })
})
