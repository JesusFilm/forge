import { describe, expect, it, vi } from "vitest"
import { Mastra } from "@mastra/core"
import { InMemoryStore } from "@mastra/core/storage"
import { LocalFilesystem, Workspace } from "@mastra/core/workspace"

import { devotionalContentWorkflow } from "./video-first-devotional"

/**
 * BEHAVIOUR, not spelling.
 *
 * Both of these seams shipped unwired: production ran them on in-code prompts
 * while every sibling read its prompt from the Workspace, which quietly took two
 * of the owner's rules off the surface she can edit without a deploy. The first
 * guard for that was a source-text assertion — it checked that
 * `authored.prompts.prompts.pointPicker` APPEARED in the file. That passes for a
 * mention in a comment, and it says nothing about what the services receive.
 *
 * So this runs the real `composeDevotionalContent` through the content step with
 * distinctive authored prompts, and asserts what actually arrives at the two
 * model-facing services. `composeDevotionalContent` is deliberately NOT mocked
 * here — mocking it is what makes the sibling suite unable to see this.
 */

const captured = vi.hoisted(() => ({
  pickPoints: vi.fn(),
  writeConclusion: vi.fn(),
  modernize: vi.fn(),
  writeCopy: vi.fn(),
  highlights: vi.fn(),
  scripture: vi.fn(),
  verifySources: vi.fn(),
}))

const POINT_PICKER_PROMPT = "AUTHORED-POINT-PICKER-PROMPT-9f2a"
const CONCLUSION_PROMPT = "AUTHORED-CONCLUSION-PROMPT-4b7c"
const MODERNIZER_PROMPT = "AUTHORED-MODERNIZER-PROMPT-1d3e"

vi.mock("../../services/devotional/reflection-point-picker", () => ({
  pickReflectionPoints: captured.pickPoints,
}))
vi.mock("../../services/devotional/devotional-conclusion", () => ({
  writeDevotionalConclusion: captured.writeConclusion,
}))
vi.mock("../../services/devotional/reflection-modernizer", () => ({
  modernizeReflection: captured.modernize,
}))
vi.mock("../../services/devotional/devotional-copy", async (importActual) => ({
  ...(await importActual()),
  writeDevotionalCopy: captured.writeCopy,
}))
vi.mock("../../services/devotional/reflection-highlighter", () => ({
  pickReflectionHighlights: captured.highlights,
}))
vi.mock("../../services/devotional/passage-scripture", () => ({
  selectScriptureForPassage: captured.scripture,
}))
vi.mock("../../services/devotional/workspace/source-verification", () => ({
  verifyWorkflowWorkspaceSources: captured.verifySources,
}))
vi.mock("../../services/devotional/workspace/provenance", () => ({
  writeInputsUsed: vi.fn(async () => "/runs/test/inputs-used.json"),
  writeAttemptJsonArtifact: vi.fn(async () => "/runs/test/artifact.json"),
}))
vi.mock("../../services/devotional/safety-gate", async (importActual) => ({
  ...(await importActual()),
  evaluateSafety: async () => ({
    verdict: "pass" as const,
    scores: { doctrine: 1, tone: 1, sensitivity: 1 },
    reasons: [],
  }),
}))
vi.mock(
  "../../services/devotional/devotional-quality-gate",
  async (importActual) => ({
    ...(await importActual()),
    reviewDevotionalText: async () => ({ blocking: [] }),
  }),
)

/** Three ordinal points, so the picker is actually consulted. */
const THREE_POINTS = [
  "These verses describe a storm on the lake.",
  "We learn, firstly, that Christ's disciples are not spared trouble.",
  "We learn, secondly, that he sleeps while they panic.",
  "We learn, thirdly, that a word from him is enough.",
].join(" ")

const CHAPTER = {
  index: 19,
  id: "1_jf6119-0-0",
  title: "Jesus Calms the Storm",
  start: "1:00:00",
  osisRef: "Luke.8.22-Luke.8.25",
  reference: "Luke 8:22-25",
  mood: "peace" as const,
  themes: ["peace"],
}

vi.mock("../../services/devotional/workspace/attempt-data", () => ({
  loadDevotionalAttemptAuthoredData: async () => ({
    prompts: {
      prompts: {
        pointPicker: POINT_PICKER_PROMPT,
        conclusion: CONCLUSION_PROMPT,
        modernizer: MODERNIZER_PROMPT,
        scripture: "s",
        highlighter: "h",
        ranker: "r",
        copy: "c",
        writer: "w",
        hookNews: "n",
        hookQuestion: "q",
        videoMatcher: "v",
        safety: "safety",
      },
      generation: {
        hookStyles: ["a bold statement"],
        blockOrders: [["hook", "scripture", "video", "reflection"]],
        partnerDomains: [],
      },
    },
    safety: {
      minimumConfidence: 0.6,
      effectiveMinimumConfidence: 0.6,
      prompt: "safety",
    },
    voices: {
      profiles: { "male-d": "voice" },
      settings: {},
      rotation: ["male-d"],
      filterRotation: ["grain"],
    },
    music: { moods: {}, defaultLengthMs: 60_000 },
    narration: {},
    brand: { name: "Jesus Film", rightsAssertion: "rights" },
    render: { filters: {}, layouts: {}, nativeLayouts: {} },
    chapters: [CHAPTER],
    passages: [CHAPTER],
    scripture: { verses: {} },
    corpora: {
      ryleMatthew: [],
      matthewHenry: [
        {
          source: "Matthew Henry, Commentary on the Whole Bible",
          reference: "Luke 8",
          osisRef: "Luke.8",
          text: THREE_POINTS,
        },
      ],
      spurgeon: [],
    },
  }),
}))

function contentInput() {
  return {
    workspaceGeneration: 1,
    attemptId: "authored-prompts",
    selectedSources: [
      {
        path: "/inputs/prompts/generation.json",
        category: "prompts" as const,
        digest: "c".repeat(64),
        size: 8077,
        modifiedAt: "2026-07-20T00:00:00.000Z",
        title: "generation prompts",
      },
    ],
    chapter: CHAPTER,
    scripture: {
      reference: "Luke 8:24",
      text: "He rebuked the wind.",
      translation: "WEB",
      needsCanonicalSource: true,
    },
    sequence: 0,
    date: "2026-07-21",
    reservationId: "49cb0cc4-2fdd-4edb-a1f6-d90664d2c885",
  }
}

describe("authored prompts reach the model-facing services", () => {
  it("hands each service its Workspace prompt, not an in-code copy", async () => {
    captured.pickPoints.mockResolvedValue({
      chosen: [1, 3],
      reason: "fit the verse",
    })
    captured.writeConclusion.mockResolvedValue({
      conclusion: "Grace that finds you keeps you.",
    })
    captured.modernize.mockResolvedValue({
      adapted: "Modernized reflection text.",
      attribution: "Adapted from Matthew Henry",
      focusReference: "Luke 8:22-25",
    })
    captured.writeCopy.mockResolvedValue({
      title: "Peace in the Storm",
      conclusion: "unused",
      question: "What storm?",
      prayer: "Jesus, calm my storm.",
    })
    captured.highlights.mockResolvedValue([])
    captured.scripture.mockResolvedValue({
      reference: "Luke 8:24",
      text: "He rebuked the wind.",
      translation: "WEB",
      needsCanonicalSource: true,
    })

    const mastra = new Mastra({
      workflows: { devotionalContentWorkflow },
      storage: new InMemoryStore({ id: "authored-prompts-test" }),
      workspace: new Workspace({
        id: "authored-prompts-test-workspace",
        name: "Authored Prompts Test Workspace",
        filesystem: new LocalFilesystem({
          id: "authored-prompts-test-fs",
          basePath: "/tmp/authored-prompts-test-workspace",
          contained: true,
        }),
        tools: { enabled: false },
      }),
    })
    const workflow = mastra.getWorkflow("devotionalContentWorkflow")
    const runId = "authored-prompts"
    const run = await workflow.createRun({ runId })
    await run.startAsync({ inputData: contentInput() })
    let state = await workflow.getWorkflowRunById(runId)
    for (
      let attempt = 0;
      attempt < 100 &&
      state?.status !== "success" &&
      state?.status !== "failed";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      state = await workflow.getWorkflowRunById(runId)
    }
    expect(state?.status).toBe("success")

    // THE assertions. Each service must have received the distinctive authored
    // string, which can only have come from the Workspace document.
    expect(captured.pickPoints).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: POINT_PICKER_PROMPT }),
    )
    expect(captured.writeConclusion).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: CONCLUSION_PROMPT }),
    )
    // A sibling that was already wired, as the control: if this one failed too,
    // the fixture would be wrong rather than the wiring.
    expect(captured.modernize).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: MODERNIZER_PROMPT }),
    )
  })
})
