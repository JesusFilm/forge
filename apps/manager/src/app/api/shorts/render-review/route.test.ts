import { beforeEach, expect, it, vi } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { POST } from "./route"
import { POST as evidencePost } from "../render-evidence/route"
const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  read: vi.fn(),
  authenticate: vi.fn(),
}))
vi.mock("@/lib/studio-request", () => ({
  authenticateStudioRequest: mocks.authenticate,
  readStudioBody: async (request: Request) =>
    new Uint8Array(await request.arrayBuffer()),
  StudioRequestTooLarge: class extends Error {},
}))
vi.mock("@/backend/studio-interactive", () => ({
  createStudioInteractiveClient: () => mocks.call,
  StudioTransportError: class extends Error {
    status = 409
  },
}))
vi.mock("@/services/studio-broker", () => ({
  createStudioAssetBroker: () => ({ read: mocks.read }),
}))
const reference = {
  assetId: "output",
  versionId: "output-v1",
  digest: "a".repeat(64),
}
const context = {
  projectId: "project",
  attemptId: "old-render",
  revision: 1,
  currentRevision: 25,
  stale: true,
  inputHash: "b".repeat(64),
  output: reference,
  outputReadyAt: "2026-09-23T00:00:00.000Z",
  evidence: null,
  document: studioDocumentSchema.parse({
    version: 1,
    title: "Old draft",
    language: "en",
    runtimeVersion: "test",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [],
  }),
}
const request = (input: unknown) =>
  new Request("http://localhost/api/shorts/render-review", {
    method: "POST",
    body: JSON.stringify(input),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticate.mockResolvedValue({ approvedByUserId: "operator" })
  mocks.call.mockResolvedValue(context)
  mocks.read.mockResolvedValue(Buffer.from("exact retained fixture"))
})
it("reads an exact prior output independently of the recent render list or a Mux release", async () => {
  const response = await POST(
    request({ projectId: "project", renderAttemptId: "old-render" }),
  )
  expect(response.status).toBe(200)
  expect(await response.text()).toBe("exact retained fixture")
  expect(mocks.call).toHaveBeenCalledWith("inspection-context", {
    projectId: "project",
    attemptId: "old-render",
  })
  expect(mocks.read).toHaveBeenCalledWith(reference, 128 * 1024 * 1024)
  expect(response.headers.get("cache-control")).toContain("no-store")
})
it("metadata review does not load video or generate inspection", async () => {
  const response = await evidencePost(
    request({ projectId: "project", attemptId: "old-render" }),
  )
  expect((await response.json()).result).toMatchObject({
    revision: 1,
    currentRevision: 25,
    stale: true,
    evidence: null,
  })
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.call).toHaveBeenCalledTimes(1)
})
it("fails closed when canonical exact-attempt authority fails", async () => {
  mocks.call.mockRejectedValue(new Error("Wrong project or unready attempt"))
  expect(
    (await POST(request({ projectId: "other", renderAttemptId: "old-render" })))
      .status,
  ).toBe(400)
  expect(mocks.read).not.toHaveBeenCalled()
})
