import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import {
  studioProjectSchema,
  studioDocumentSchema,
  studioApplySchema,
} from "@forge/studio-contracts"
import { studioHash } from "@forge/studio-server"
import { streamStudioAgent } from "./agent"
const root = new URL(
  "../../../../../docs/validation/studio-458/",
  import.meta.url,
)
const bound = JSON.parse(
  readFileSync(
    new URL("model-comparison-1/verified-bound-proposal.body", root),
    "utf8",
  ),
)
const current = bound.cases.find(
  (c: { case: string }) => c.case === "ch33-seq0-ep2",
)
const proposal = JSON.parse(
  readFileSync(
    new URL("effective-speech-feedback/slot0-original-proposal.json", root),
    "utf8",
  ),
)
const saved = JSON.parse(
  readFileSync(
    new URL("model-comparison-1/live/retained-0.body", root),
    "utf8",
  ),
).result.previews[0]
const document = studioDocumentSchema.parse(saved.document)

it("lets the next native turn inspect actual final speech instead of overwritten original intent", async () => {
  const prompts: string[] = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(JSON.stringify(options.prompt))
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] })
            if (prompts.length === 1)
              controller.enqueue({
                type: "tool-call",
                toolCallId: "original-slot0",
                toolName: "proposeEdits",
                input: JSON.stringify(proposal),
              })
            controller.enqueue({
              type: "finish",
              finishReason: {
                unified: prompts.length === 1 ? "tool-calls" : "stop",
                raw: prompts.length === 1 ? "tool_calls" : "stop",
              },
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
  const emitted: unknown[] = []
  await streamStudioAgent({
    project: studioProjectSchema.parse(current.project),
    frozen: bound.frozenNativeInstructions,
    message: current.message,
    model,
    signal: new AbortController().signal,
    emit: (event) => emitted.push(event),
    assetCall: async (action, input) => {
      expect(action).toBe("validate-proposal")
      const command = studioApplySchema.parse(
        Reflect.get(Object(input), "command"),
      )
      // Independent expected speech comes from the retained canonical document,
      // not from the original provider's earlier set-speech intent.
      const items = document.items
        .filter((i) => i.speech)
        .map((i) => ({
          itemId: i.id,
          trackId: i.trackId,
          startFrame: i.startFrame,
          durationInFrames: i.durationInFrames,
          role: i.speech!.role,
          suppressed: false,
          text: i.speech!.text,
          spoken: true,
        }))
      return {
        valid: true,
        projectId: command.projectId,
        revision: command.expectedRevision,
        quality: proposal.quality,
        effectiveSpeech: {
          version: 1,
          projectId: command.projectId,
          baseRevision: command.expectedRevision,
          language: document.language,
          operationsDigest: studioHash(command.operations),
          scriptDigest: "a".repeat(64),
          speechItemCount: 3,
          spokenItemCount: 3,
          suppressedItemCount: 0,
          emptyItemCount: 0,
          exactTextUtf8Bytes: items.reduce(
            (sum, i) => sum + Buffer.byteLength(i.text),
            0,
          ),
          view: "inline",
          complete: true,
          items,
        },
      }
    },
  })
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toContain("effectiveSpeech")
  expect(prompts[1]).toContain("Common fame is not righteous judgment.")
  const toolMessage = JSON.parse(prompts[1]).find(
    (m: { role: string }) => m.role === "tool",
  )
  const output = toolMessage.content[0].output.value
  expect(output.validation).not.toHaveProperty("quality")
  expect(
    output.validation.effectiveSpeech.items.map(
      (i: { text: string }) => i.text,
    ),
  ).toEqual(document.items.filter((i) => i.speech).map((i) => i.speech!.text))
  expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(32768)
  expect(JSON.stringify(toolMessage)).toContain("complete")
  expect(emitted).toHaveLength(1)
})
