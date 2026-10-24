import { expect, it, vi } from "vitest"
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
const f = vi.hoisted(() => ({ register: vi.fn(), factory: vi.fn() }))
vi.mock("./studio-broker", () => ({
  createStudioAssetBroker: (...args: unknown[]) => {
    f.factory(...args)
    return { register: f.register }
  },
}))
import { retainStudioRenderOutputPart } from "./studio-render-retention"

it("registers each part as a private immutable archive with exact producer and output provenance", async () => {
  const call = vi.fn(),
    signal = new AbortController().signal
  const part = {
    index: 0,
    count: 1,
    byteSize: 4,
    totalBytes: 4,
    outputDigest: "a".repeat(64),
    retentionDeadlineMs: Date.now() + 40000,
  }
  const reference = {
    assetId: "asset",
    versionId: "version",
    digest: "b".repeat(64),
  }
  f.register.mockResolvedValueOnce(reference)
  expect(
    await retainStudioRenderOutputPart(
      call,
      { inputHash: "c".repeat(64) },
      { attemptId: "attempt", leaseId: "lease" },
      part,
      Buffer.from("part"),
      signal,
    ),
  ).toEqual(reference)
  expect(f.factory).toHaveBeenLastCalledWith(call, expect.any(AbortSignal))
  expect(f.register).toHaveBeenLastCalledWith(
    "attempt-part-0.bin",
    "application/octet-stream",
    "archive",
    Buffer.from("part"),
    [],
    {
      attemptId: "attempt",
      leaseId: "lease",
      profileId: STUDIO_RENDER_PROFILE.id,
      inputHash: "c".repeat(64),
      outputDigest: part.outputDigest,
      outputBytes: 4,
      partIndex: 0,
      partCount: 1,
      retentionDeadlineMs: part.retentionDeadlineMs,
    },
  )
})

it("refuses inconsistent or aborted part registration before creating a storage broker", async () => {
  f.factory.mockClear()
  const part = {
      index: 0,
      count: 1,
      byteSize: 4,
      totalBytes: 4,
      outputDigest: "a".repeat(64),
      retentionDeadlineMs: Date.now() + 40000,
    },
    call = vi.fn()
  await expect(
    retainStudioRenderOutputPart(
      call,
      { inputHash: "c".repeat(64) },
      { attemptId: "attempt", leaseId: "lease" },
      part,
      Buffer.from("bad"),
      new AbortController().signal,
    ),
  ).rejects.toThrow()
  const controller = new AbortController()
  controller.abort()
  await expect(
    retainStudioRenderOutputPart(
      call,
      { inputHash: "c".repeat(64) },
      { attemptId: "attempt", leaseId: "lease" },
      part,
      Buffer.from("part"),
      controller.signal,
    ),
  ).rejects.toThrow()
  expect(f.factory).not.toHaveBeenCalled()
})
