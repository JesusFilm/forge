import { expect, it } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { APICallError } from "ai"
import { studioProjectSchema } from "@forge/studio-contracts"
import type { StudioAgentEvent } from "@forge/studio-contracts/agent"
import { streamStudioAgent } from "./agent"
import { createOpenAI } from "@ai-sdk/openai"
import { readFileSync } from "node:fs"

it("does not replay a retained truncated tool call through the native SDK loop", async () => {
  const evidence = new URL(
    "../../../../../docs/validation/studio-458/model-comparison-1/",
    import.meta.url,
  )
  const bound = JSON.parse(
    readFileSync(new URL("verified-bound-proposal.body", evidence), "utf8"),
  )
  const current = bound.cases.find(
    (candidate: { case: string }) => candidate.case === "ch19-seq102",
  )
  expect(bound.runOrder[3].case).toBe(current.case)
  expect(current.project.projectId).toBe("000458-native-ch19-seq102")
  const requests: string[] = []
  const model = createOpenAI({
    apiKey: "retained-fixture-no-network",
    fetch: async (_url, init) => {
      const index = requests.length
      requests.push(String(init?.body))
      if (index > 1) throw new Error("Unexpected replay; network is disabled")
      return new Response(
        readFileSync(
          new URL(`live/request-3-${index}-response.body`, evidence),
          "utf8",
        ),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  }).chat("openai/gpt-5.4")
  const failure = await streamStudioAgent({
    project: studioProjectSchema.parse(current.project),
    frozen: bound.frozenNativeInstructions,
    message: current.message,
    model,
    signal: new AbortController().signal,
    emit: () => {},
    assetCall: async (action) => {
      if (action === "pack") return current.pack
      throw new Error("Unexpected tool action in retained fixture")
    },
  }).catch((error: unknown) => error)
  expect(requests).toHaveLength(2)
  expect(failure).toMatchObject({
    message:
      "Studio tool call was incomplete or malformed. Retained outputs require review; no retry was attempted.",
  })
})
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
it("retains an earlier validated proposal when a later malformed tool turn stalls", async () => {
  let calls = 0
  const events: StudioAgentEvent[] = []
  const proposal = {
    summary: "Retained proposal",
    operations: [{ kind: "set-metadata", title: "Retained title" }],
  }
  const model = new MockLanguageModelV3({
    doStream: async () => {
      calls++
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] })
            if (calls === 1)
              controller.enqueue({
                type: "tool-call",
                toolCallId: "retained",
                toolName: "proposeEdits",
                input: JSON.stringify(proposal),
              })
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool_calls" },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            })
            controller.close()
          },
        }),
      }
    },
  })
  await expect(
    streamStudioAgent({
      project,
      frozen,
      model,
      message: "Propose",
      signal: new AbortController().signal,
      assetCall: async () => ({ valid: true }),
      emit: (event) => events.push(event),
    }),
  ).rejects.toThrow("Studio tool call was incomplete or malformed")
  expect(calls).toBe(2)
  expect(events).toEqual([
    expect.objectContaining({
      type: "proposal",
      proposal: expect.objectContaining({
        summary: proposal.summary,
        command: expect.objectContaining({ operations: proposal.operations }),
      }),
    }),
  ])
})
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
