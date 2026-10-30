import {
  STUDIO_RENDER_PROFILE,
  STUDIO_RENDER_OUTPUT_PART_BYTES,
} from "@forge/studio-contracts/render"
import { PrismaClient } from "@prisma/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { writeMediaObject } from "@/storage/media"
import { byteDigest } from "./assets"
import { StudioTransferService } from "./transfers"

vi.mock("@/storage/media", async (original) => ({
  ...(await original<typeof import("@/storage/media")>()),
  writeMediaObject: vi.fn(),
}))
const db = new PrismaClient()
const bytes = Buffer.from("bounded upload")
const token = "a".repeat(64)
const grant = () => ({
  tokenHash: byteDigest(Buffer.from(token)),
  kind: "upload",
  principal: { id: null, role: "MANAGER_BACKEND" },
  payload: {
    metadata: {
      idempotencyKey: "abort-upload-fixture",
      filename: "part.bin",
      mimeType: "application/octet-stream",
      role: "archive",
      provenance: { status: "recorded", recorded: {} },
    },
    byteSize: bytes.length,
    digest: byteDigest(bytes),
  },
  expiresAt: new Date(Date.now() + 300000),
})
beforeEach(() => {
  vi.spyOn(db.shortAssetTransfer, "findUnique").mockResolvedValue(grant())
  vi.spyOn(db.shortAssetVersion, "findUnique").mockResolvedValue(null)
  vi.spyOn(db, "$transaction")
  vi.mocked(writeMediaObject).mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// Runs actual upload -> StudioAssetService.register, stopping only at storage I/O.
async function pendingStorage() {
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.mocked(writeMediaObject).mockImplementation(({ signal }) => {
    if (!signal) throw new TypeError("Upload storage requires cancellation")
    signal.throwIfAborted()
    entered()
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      })
    })
  })
  return started
}

describe("transfer upload cancellation", () => {
  it("aborts before authorization or storage", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new StudioTransferService(db).upload(
        token,
        new Response(bytes).body,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(db.shortAssetTransfer.findUnique).not.toHaveBeenCalled()
    expect(writeMediaObject).not.toHaveBeenCalled()
  })
  it("cancels a pending body read without storing or registering bytes", async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const pending = new StudioTransferService(db).upload(
      token,
      body,
      controller.signal,
    )
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    })
    await vi.waitFor(() => expect(body.locked).toBe(true))
    controller.abort()
    await rejected
    expect(cancel).toHaveBeenCalled()
    expect(writeMediaObject).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it("aborts actual asset registration storage after the request body has been consumed", async () => {
    const controller = new AbortController()
    const started = pendingStorage()
    const request = new Request("https://fixture.invalid/upload", {
      method: "PUT",
      body: bytes,
      signal: controller.signal,
    })
    const pending = new StudioTransferService(db).upload(
      token,
      request.body,
      request.signal,
    )
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    })
    await started
    expect(request.bodyUsed).toBe(true)
    controller.abort()
    await rejected
    expect(writeMediaObject).toHaveBeenCalledOnce()
    expect(vi.mocked(writeMediaObject).mock.calls[0][0].signal?.aborted).toBe(
      true,
    )
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it("expires pending storage at the original issued grant deadline", async () => {
    vi.mocked(db.shortAssetTransfer.findUnique).mockResolvedValue({
      ...grant(),
      expiresAt: new Date(Date.now() + 150),
    })
    const started = pendingStorage()
    const pending = new StudioTransferService(db).upload(
      token,
      new Response(bytes).body,
    )
    const rejected = expect(pending).rejects.toMatchObject({
      name: "TimeoutError",
    })
    await started
    await rejected
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe("render output part grant deadline", () => {
  const worker = { id: null, role: "MANAGER_BACKEND" as const }
  function part(deadline: unknown, index = 0) {
    const payload = grant().payload
    return {
      ...payload,
      byteSize: index === 0 ? STUDIO_RENDER_OUTPUT_PART_BYTES : bytes.length,
      metadata: {
        ...payload.metadata,
        provenance: {
          status: "recorded",
          recorded: {
            profileId: STUDIO_RENDER_PROFILE.id,
            outputDigest: byteDigest(bytes),
            outputBytes: STUDIO_RENDER_OUTPUT_PART_BYTES + bytes.length,
            partIndex: index,
            partCount: 2,
            retentionDeadlineMs: deadline,
          },
        },
      },
    }
  }
  it("preserves one deadline for later parts and retries and refuses issuance or upload after expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const now = Date.now(),
      deadline = now + 40000
    const create = vi
      .spyOn(db.shortAssetTransfer, "create")
      .mockResolvedValue(grant())
    const service = new StudioTransferService(db)
    const first = await service.issue(worker, "upload", part(deadline))
    vi.setSystemTime(now + 10000)
    const later = await service.issue(worker, "upload", part(deadline, 1))
    const retry = await service.issue(worker, "upload", part(deadline))
    for (const issued of [first, later, retry])
      expect(issued.expiresAt).toBe(new Date(deadline).toISOString())
    for (const call of create.mock.calls)
      expect(call[0].data.expiresAt).toEqual(new Date(deadline))
    vi.setSystemTime(deadline)
    await expect(
      service.issue(worker, "upload", part(deadline, 1)),
    ).rejects.toThrow("INVALID")
    expect(create).toHaveBeenCalledTimes(3)
    vi.mocked(db.shortAssetTransfer.findUnique).mockResolvedValue({
      ...grant(),
      expiresAt: new Date(deadline),
    })
    await expect(
      service.upload(token, new Response(bytes).body),
    ).rejects.toThrow()
    expect(writeMediaObject).not.toHaveBeenCalled()
  })
  it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "future"])(
    "rejects invalid part deadline %s before issuing",
    async (deadline) => {
      const create = vi.spyOn(db.shortAssetTransfer, "create")
      await expect(
        new StudioTransferService(db).issue(worker, "upload", part(deadline)),
      ).rejects.toThrow()
      expect(create).not.toHaveBeenCalled()
    },
  )
  it("rejects a future deadline beyond the 45-second bound", async () => {
    await expect(
      new StudioTransferService(db).issue(
        worker,
        "upload",
        part(Date.now() + 46000),
      ),
    ).rejects.toThrow("INVALID")
  })
  it("leaves ordinary upload grant expiry unchanged", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.spyOn(db.shortAssetTransfer, "create").mockResolvedValue(grant())
    const now = Date.now()
    expect(
      (
        await new StudioTransferService(db).issue(
          worker,
          "upload",
          grant().payload,
        )
      ).expiresAt,
    ).toBe(new Date(now + 300000).toISOString())
  })
})
