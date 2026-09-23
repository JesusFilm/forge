import { beforeEach, expect, it, vi } from "vitest"
import { executeNarration } from "./narration"
import { studioProductionClient } from "./transport"
import { ElevenStudioProvider } from "./provider"
import { narrationInputDigest } from "./runner"
import type {
  StudioNarrationIdentity,
  ShortAssetVersion,
} from "@forge/studio-contracts/assets"
vi.mock("@/config/env", () => ({
  env: { ELEVENLABS_API_KEY: "deterministic-fake-only" },
}))
vi.mock("./transport", () => ({ studioProductionClient: vi.fn() }))
vi.mock("./provider", async (original) => ({
  ...(await original<typeof import("./provider")>()),
  ElevenStudioProvider: vi.fn(),
}))
vi.mock("./audio", () => ({ measureStudioAudio: async () => 1000 }))
const identity: StudioNarrationIdentity = {
  text: "Hope remains.",
  role: "narration",
  language: "en",
  provider: "elevenlabs",
  model: "eleven_multilingual_v2",
  voiceId: "approved",
  settings: { language_code: "en" },
  pronunciation: null,
}
beforeEach(() => vi.clearAllMocks())
it("uses the admitted snapshot with the existing provider runner and recovers lost responses without redispatch", async () => {
  const reference = {
    assetId: "retained",
    versionId: "retained-v1",
    digest: "a".repeat(64),
  }
  const retained: ShortAssetVersion = {
    reference,
    mediaAssetId: "media",
    filename: "narration.mp3",
    mimeType: "audio/mpeg",
    byteSize: 6,
    role: "narration",
    narration: identity,
    voice: null,
    actor: { kind: "service", id: "manager_backend" },
    provenance: {
      status: "recorded",
      recorded: { durationMs: 1000, mediaValidated: true },
    },
  }
  const narrate = vi.fn(async () => ({
    bytes: Buffer.from("fake"),
    requestId: "fake-request",
    credits: 1,
  }))
  vi.mocked(ElevenStudioProvider).mockImplementation(
    () => ({ narrate }) as unknown as ElevenStudioProvider,
  )
  let finished: unknown = null
  const call = vi.fn(async (command: string, input: unknown) => {
    if (command === "context")
      return {
        run: { state: "READY", calls: finished ? [finished] : [] },
        attempt: { projectId: "project", baseRevision: 1 },
        narrationPlan: {
          projectId: "project",
          revision: 1,
          segments: [
            {
              itemId: "spoken",
              identity,
              matches: [],
              pronunciationLocators: [],
            },
          ],
        },
      }
    if (command === "claim") {
      expect(input).toEqual({
        key: `speech-${narrationInputDigest(identity)}`,
        inputDigest: narrationInputDigest(identity),
        reserveMicros: 0,
      })
      return finished
        ? { execute: false, call: { state: "COMPLETED", result: finished } }
        : { execute: true, call: { state: "RUNNING", result: null } }
    }
    if (command === "finish") {
      finished = { assets: [reference] }
      return { recorded: true }
    }
    if (command === "narration-complete")
      return {
        projectId: "project",
        revision: 2,
        attemptId: "attempt",
        outcome: "ACCEPTED",
      }
    throw new Error(`Unexpected test command ${command}`)
  })
  vi.mocked(studioProductionClient).mockReturnValue({
    call,
    upload: vi.fn(async () => retained),
  })
  const read = vi.fn(async (action: string) => {
    expect(action).toBe("asset") // Current revision may have changed; never rebuild the accepted plan.
    return retained
  })
  await executeNarration("operator", read, "run")
  await executeNarration("operator", read, "run")
  expect(narrate).toHaveBeenCalledTimes(1)
  expect(
    call.mock.calls.filter(([name]) => name === "narration-complete"),
  ).toHaveLength(2)
})
