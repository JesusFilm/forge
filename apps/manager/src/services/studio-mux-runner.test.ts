import { expect, it, vi } from "vitest"
import { runStudioMuxCandidate, type StudioMuxPort } from "./studio-mux-runner"
function port(state = "UPLOADING"): StudioMuxPort {
  return {
    read: vi.fn(async () => ({
      id: "job",
      state,
      dispatchId: "dispatch",
      uploadId: "upload",
      assetId: null,
    })),
    upload: vi.fn(async () => ({
      id: "upload",
      status: "asset_created",
      asset_id: "asset",
    })),
    failed: vi.fn(),
    created: vi.fn(),
    observe: vi.fn(async () => ({ status: "ready" })),
    ready: vi.fn(),
    stage: vi.fn(),
  }
}
it("only observes the exact direct upload and binds its resulting asset", async () => {
  const p = port()
  await runStudioMuxCandidate("attempt", p)
  expect(p.upload).toHaveBeenCalledWith("upload")
  expect(p.created).toHaveBeenCalledWith("job", "dispatch", "asset")
})
it.each(["PENDING", "AMBIGUOUS", "DISPATCHING"])(
  "never creates a replacement for %s",
  async (state) => {
    const p = port(state)
    await runStudioMuxCandidate("attempt", p)
    expect(p.upload).not.toHaveBeenCalled()
    expect(p.created).not.toHaveBeenCalled()
  },
)
it("rejects changed upload identity", async () => {
  const p = port()
  p.upload = async () => ({
    id: "other",
    status: "asset_created",
    asset_id: "asset",
  })
  await expect(runStudioMuxCandidate("attempt", p)).rejects.toThrow(
    "identity changed",
  )
  expect(p.created).not.toHaveBeenCalled()
})

it("records provider upload expiration without replacement", async () => {
  const p = port()
  p.upload = async () => ({ id: "upload", status: "timed_out" })
  await runStudioMuxCandidate("attempt", p)
  expect(p.failed).toHaveBeenCalledWith("job", "upload")
  expect(p.created).not.toHaveBeenCalled()
})
