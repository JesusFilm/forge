import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { MockLanguageModelV3 } from "ai/test"
import { studioProjectSchema } from "@forge/studio-contracts"
import {
  StudioCoverageError,
  validateStudioRoleCoverage,
} from "@forge/studio-contracts/production"
import { streamStudioAgent } from "./agent"
import { rejectStudioAssetTool } from "./tool-feedback"
const evidence = new URL(
  "../../../../../docs/validation/studio-458/",
  import.meta.url,
)
const approved = JSON.parse(
  readFileSync(
    new URL(
      "native-hosted-proposal/corrected-readonly-proposal.body",
      evidence,
    ),
    "utf8",
  ),
)
const rejected = JSON.parse(
  readFileSync(
    new URL("native-hosted-live/paid-1-2-response-proposal-0.json", evidence),
    "utf8",
  ),
)
it("returns bounded canonical role facts to the next native model turn for the actual ch31 rejection", async () => {
  const project = studioProjectSchema.parse(approved.cases[1].project)
  let feedback: unknown
  try {
    validateStudioRoleCoverage(project.document, rejected.quality.coverage)
  } catch (error) {
    if (error instanceof StudioCoverageError) feedback = error.feedback
    else throw error
  }
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
                toolCallId: "actual-rejected",
                toolName: "proposeEdits",
                input: JSON.stringify(rejected),
              })
            controller.enqueue({
              type: "finish",
              finishReason: {
                unified: prompts.length === 1 ? "tool-calls" : "stop",
                raw: prompts.length === 1 ? "tool-calls" : "stop",
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
  const proposals: unknown[] = []
  await streamStudioAgent({
    project,
    frozen: approved.frozenNativeInstructions,
    message: approved.cases[1].message,
    model,
    signal: new AbortController().signal,
    emit: (event) => proposals.push(event),
    assetCall: async (action) =>
      rejectStudioAssetTool(
        action,
        Response.json(
          { error: "Studio role coverage rejected", feedback },
          { status: 400 },
        ),
      ),
  })
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toContain("ROLE_COVERAGE_MISMATCH")
  expect(prompts[1]).toContain('\\"role\\":\\"hook\\"')
  expect(prompts[1]).toContain('\\"expectedItemCount\\":0')
  expect(prompts[1]).toContain(
    "semantic QA concerns such as scripture echo in findings",
  )
  expect(proposals).toEqual([])
})
it("does not expose arbitrary upstream errors, malformed bytes or feedback on another action", async () => {
  for (const [action, response] of [
    [
      "validate-proposal",
      Response.json({ error: "private database detail" }, { status: 400 }),
    ],
    [
      "validate-proposal",
      new Response("private malformed detail", { status: 400 }),
    ],
    ["validate-proposal", new Response("x".repeat(4097), { status: 400 })],
    [
      "capture",
      Response.json({ error: "private database detail" }, { status: 400 }),
    ],
  ] as const)
    await expect(rejectStudioAssetTool(action, response)).rejects.toThrow(
      "Studio asset tool rejected",
    )
})
it("returns safe field types to the next native model turn for the actual ch19 rejection", async () => {
  const project = studioProjectSchema.parse(approved.cases[0].project)
  const rejected = JSON.parse(
    readFileSync(
      new URL(
        "native-hosted-followup-2/live/paid-0-2-response-proposal-0.json",
        evidence,
      ),
      "utf8",
    ),
  )
  const feedback = {
    code: "PROPOSAL_FIELD_TYPE_MISMATCH",
    issues: [
      { path: ["operations", 6, "properties", "fontSize"], expected: "number" },
    ],
  }
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
                toolCallId: "actual-rejected",
                toolName: "proposeEdits",
                input: JSON.stringify(rejected),
              })
            controller.enqueue({
              type: "finish",
              finishReason: {
                unified: prompts.length === 1 ? "tool-calls" : "stop",
                raw: prompts.length === 1 ? "tool-calls" : "stop",
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
  const proposals: unknown[] = []
  await streamStudioAgent({
    project,
    frozen: approved.frozenNativeInstructions,
    message: approved.cases[0].message,
    model,
    signal: new AbortController().signal,
    emit: (event) => proposals.push(event),
    assetCall: async (action) =>
      rejectStudioAssetTool(
        action,
        Response.json(
          { error: "Studio proposal fields rejected", feedback },
          { status: 400 },
        ),
      ),
  })
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toContain("PROPOSAL_FIELD_TYPE_MISMATCH")
  expect(prompts[1]).toContain("fontSize")
  expect(prompts[1]).toContain("number")
  expect(prompts[1]).toContain("Other validation errors may remain")
  expect(proposals).toEqual([])
})
it("rejects forged, oversized and unrelated field-feedback envelopes without echoing values", async () => {
  const issue = {
    path: ["operations", 6, "properties", "fontSize"],
    expected: "number",
  }
  const body = {
    error: "Studio proposal fields rejected",
    feedback: { code: "PROPOSAL_FIELD_TYPE_MISMATCH", issues: [issue] },
  }
  for (const [action, status, payload] of [
    ["capture", 400, body],
    ["validate-proposal", 500, body],
    ["validate-proposal", 400, { ...body, suppliedValue: "private-source" }],
    [
      "validate-proposal",
      400,
      {
        ...body,
        feedback: {
          ...body.feedback,
          issues: [
            {
              ...issue,
              path: ["operations", 6, "properties", "private-source"],
            },
          ],
        },
      },
    ],
    [
      "validate-proposal",
      400,
      {
        ...body,
        feedback: {
          ...body.feedback,
          issues: [{ ...issue, expected: "private-source" }],
        },
      },
    ],
    [
      "validate-proposal",
      400,
      { ...body, feedback: { ...body.feedback, issues: Array(9).fill(issue) } },
    ],
  ] as const) {
    await expect(
      rejectStudioAssetTool(action, Response.json(payload, { status })),
    ).rejects.toThrow("Studio asset tool rejected")
  }
})
