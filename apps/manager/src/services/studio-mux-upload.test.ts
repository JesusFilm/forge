import { beforeEach, expect, it, vi } from "vitest"
const f = vi.hoisted(() => ({
  call: vi.fn(),
  create: vi.fn(),
  observe: vi.fn(),
  env: { STUDIO_MUX_INGEST_ENABLED: "true" },
}))
vi.mock("@/config/env", () => ({ env: f.env }))
vi.mock("./studio-render-transport", () => ({
  studioRenderClient: () => ({ call: f.call }),
}))
vi.mock("./studio-render-mux", () => ({
  createStudioMuxUpload: f.create,
  observeStudioMuxUpload: f.observe,
}))
import { prepareStudioMuxUpload } from "./studio-mux-upload"
const digest = "a".repeat(64)
function job(state = "PENDING", uploadId: string | null = null) {
  return {
    id: "job",
    state,
    dispatchId: "dispatch",
    uploadId,
    assetId: null,
    snapshot: {
      leaseId: "lease",
      manifest: {
        version: 1,
        projectId: "short",
        revision: 1,
        renderAttemptId: "attempt",
        inputHash: digest,
        output: { assetId: "output", versionId: "version", digest },
        language: "english",
        runtimeVersion: "v1",
        width: 320,
        height: 180,
        fps: 30,
        durationInFrames: 30,
        verification: {
          status: "verified",
          verifierVersion: "v1",
          outputDigest: digest,
        },
      },
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  f.env.STUDIO_MUX_INGEST_ENABLED = "true"
  f.create.mockResolvedValue({ id: "upload" })
  f.observe.mockResolvedValue({
    id: "upload",
    status: "waiting",
    url: "https://storage.googleapis.com/mux?signature=fixture",
  })
  f.call.mockImplementation(async (command) => {
    if (command === "mux-enqueue") return job()
    if (command === "mux-claim")
      return { execute: true, dispatchId: "dispatch" }
    if (command === "mux-upload-created") return job("UPLOADING", "upload")
    if (["mux-upload-eligible", "mux-ambiguous"].includes(command)) return {}
    throw new Error("Unexpected canonical operation")
  })
})
it("records the consumed upload before returning its URL and never requests Forge asset transfer", async () => {
  expect(
    await prepareStudioMuxUpload(
      "attempt",
      "lease",
      new AbortController().signal,
    ),
  ).toMatchObject({ state: "upload", uploadId: "upload", digest })
  expect(f.call.mock.calls.map(([command]) => command)).toEqual([
    "mux-enqueue",
    "mux-claim",
    "mux-upload-created",
    "mux-upload-eligible",
  ])
  expect(f.create).toHaveBeenCalledWith("job", expect.any(AbortSignal))
})
it("recovers the same recorded upload and refuses an ambiguous create", async () => {
  f.call.mockImplementation(async (command) =>
    command === "mux-enqueue" ? job("UPLOADING", "upload") : {},
  )
  await prepareStudioMuxUpload("attempt", "lease", new AbortController().signal)
  expect(f.create).not.toHaveBeenCalled()
  f.call.mockResolvedValue(job("AMBIGUOUS"))
  await expect(
    prepareStudioMuxUpload("attempt", "lease", new AbortController().signal),
  ).rejects.toThrow("unconfirmed")
  expect(f.create).not.toHaveBeenCalled()
})
it("consumes once when provider creation response is lost", async () => {
  f.create.mockRejectedValue(new Error("response lost"))
  await expect(
    prepareStudioMuxUpload("attempt", "lease", new AbortController().signal),
  ).rejects.toThrow()
  expect(f.call).toHaveBeenCalledWith("mux-ambiguous", {
    id: "job",
    dispatchId: "dispatch",
  })
})
it("refuses a different lease before spending and honors disablement", async () => {
  await expect(
    prepareStudioMuxUpload("attempt", "other", new AbortController().signal),
  ).rejects.toThrow("lease")
  expect(f.create).not.toHaveBeenCalled()
  f.env.STUDIO_MUX_INGEST_ENABLED = "false"
  f.call.mockClear()
  expect(
    await prepareStudioMuxUpload(
      "attempt",
      "lease",
      new AbortController().signal,
    ),
  ).toEqual({ state: "disabled" })
  expect(f.call).not.toHaveBeenCalled()
})
it("does not disclose URL after an eligibility change during provider observation", async () => {
  f.call.mockImplementation(async (command) => {
    if (command === "mux-enqueue") return job("UPLOADING", "upload")
    throw new Error("Revision changed")
  })
  await expect(
    prepareStudioMuxUpload("attempt", "lease", new AbortController().signal),
  ).rejects.toThrow("Revision changed")
})
