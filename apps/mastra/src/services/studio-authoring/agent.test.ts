import { expect, it } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { APICallError } from "ai"
import { studioProjectSchema } from "@forge/studio-contracts"
import { streamStudioAgent } from "./agent"
const project = studioProjectSchema.parse({
  projectId: "bounded-native",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "operator", authority: "interactive" },
  document: {
    version: 1,
    title: "An editorial project",
    language: "en",
    runtimeVersion: "test",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 90,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [],
  },
})
const frozen = {
  effective: "Propose editable source-led work. Do not spend on narration.",
  agentVersionId: "agent-v1",
  agentDigest: "a".repeat(64),
  blockVersionId: "block-v1",
  blockDigest: "b".repeat(64),
  digest: "c".repeat(64),
}
it("sends a bounded output allowance and does not retry an uncertain provider error", async () => {
  const observed: number[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      observed.push(options.maxOutputTokens ?? 0)
      throw new APICallError({
        message: "Uncertain provider response",
        url: "https://provider.invalid/generate",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      })
    },
  })
  await expect(
    streamStudioAgent({
      project,
      frozen,
      model,
      message: "Create one proposal",
      signal: new AbortController().signal,
      emit: () => {},
    }),
  ).rejects.toThrow()
  expect(observed).toEqual([4096])
})
