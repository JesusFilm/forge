import { studioDocumentSchema } from "@forge/studio-contracts"
import { expect, it, vi } from "vitest"
import { prepareStudioDraftRenderInput } from "./studio-render-input"
import { prepareStudioRenderSources } from "./studio-broker"
vi.mock("./studio-broker", async (load) => ({
  ...(await load<typeof import("./studio-broker")>()),
  prepareStudioRenderSources: vi.fn(),
}))
vi.mock("@/config/env", () => ({ env: {} }))
it("prepares canonical sources before byte assembly without writing the admitted revision", async () => {
  const document = studioDocumentSchema.parse({
    version: 1,
    title: "Prepared",
    language: "english",
    runtimeVersion: "studio-test",
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 30,
    tracks: [],
    components: [],
    items: [],
    packRevisionIds: [],
  })
  vi.mocked(prepareStudioRenderSources).mockResolvedValue({ document })
  const call = vi.fn(async () => []),
    signal = new AbortController().signal
  const result = await prepareStudioDraftRenderInput(
    call,
    "project",
    document,
    "proof-key",
    signal,
    { read: async () => null, save: async (document) => ({ document }) },
  )
  expect(prepareStudioRenderSources).toHaveBeenCalledWith(
    call,
    "project",
    document,
    signal,
  )
  expect(result.input.document).toEqual(document)
  expect(call).toHaveBeenCalledExactlyOnceWith("preview-sources", {
    projectId: "project",
    document,
  })
})
it("does not assemble or execute bytes after canonical preparation fails", async () => {
  vi.mocked(prepareStudioRenderSources).mockRejectedValue(
    new Error("Canonical source is no longer eligible"),
  )
  const call = vi.fn()
  await expect(
    prepareStudioDraftRenderInput(
      call,
      "project",
      {},
      "proof-key",
      new AbortController().signal,
      { read: async () => null, save: async (document) => ({ document }) },
    ),
  ).rejects.toThrow("no longer eligible")
  expect(call).not.toHaveBeenCalled()
})
