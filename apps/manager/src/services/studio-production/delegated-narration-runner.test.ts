import { beforeEach, expect, it, vi } from "vitest"
import { executeNarration } from "./narration"
import { executeDelegatedNarration } from "./delegated-narration"
import { studioServiceCall } from "@/services/studio-agent/transport"
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
vi.mock("@/services/studio-agent/transport", () => ({
  studioServiceCall: vi.fn(),
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

class LostResponse extends Error {}
const caller = {
  sub: "operator",
  authority: "delegated" as const,
  clientId: "codex",
  scopes: ["shorts:read", "shorts:narration"],
}
function recoveryFixture() {
  const reference = {
    assetId: "audio",
    versionId: "audio-v1",
    digest: "a".repeat(64),
  }
  const retained: ShortAssetVersion = {
    reference,
    mediaAssetId: "media",
    filename: "narration.mp3",
    mimeType: "audio/mpeg",
    byteSize: 4,
    role: "narration",
    narration: identity,
    voice: null,
    actor: { kind: "service", id: "manager_backend" },
    provenance: {
      status: "recorded",
      recorded: { durationMs: 1000, mediaValidated: true },
    },
  }
  const state = {
    run: "READY",
    call: "ABSENT",
    failFinish: false,
    failComplete: false,
    failContext: false,
  }
  const narrate = vi.fn(async () => ({
    bytes: Buffer.from("fake"),
    requestId: "fake",
    credits: 1,
  }))
  vi.mocked(ElevenStudioProvider).mockImplementation(
    () => ({ narrate }) as unknown as ElevenStudioProvider,
  )
  const call = vi.fn(async (command: string) => {
    if (command === "context") {
      if (state.failContext) {
        state.failContext = false
        throw new LostResponse("Context response lost")
      }
      return {
        run: {
          state: state.run,
          calls: state.call === "COMPLETED" ? [{}] : [],
        },
        attempt: { projectId: "project", baseRevision: 1 },
        narrationPlan: {
          projectId: "project",
          revision: 1,
          segments: [
            {
              itemId: "speech",
              identity,
              matches: [],
              pronunciationLocators: [],
            },
          ],
        },
      }
    }
    if (command === "claim") {
      if (state.call !== "ABSENT")
        return {
          execute: false,
          call: {
            state: state.call,
            result: state.call === "COMPLETED" ? { assets: [reference] } : null,
          },
        }
      state.call = "RUNNING"
      return { execute: true, call: { state: "RUNNING", result: null } }
    }
    if (command === "finish") {
      state.call = "COMPLETED"
      if (state.failFinish) {
        state.failFinish = false
        throw new LostResponse("Finish committed but response lost")
      }
      return { recorded: true }
    }
    if (command === "narration-complete") {
      state.run = "COMPLETED"
      if (state.failComplete) {
        state.failComplete = false
        throw new LostResponse("Attachment committed but response lost")
      }
      return {
        projectId: "project",
        revision: 2,
        attemptId: "attempt",
        outcome: "ACCEPTED",
      }
    }
    if (command === "reconciliation-note")
      return { recorded: true, outcome: "RECONCILIATION_REQUIRED" }
    // No observer may mutate run/attempt/paid-claim state after a transport failure.
    throw new LostResponse(`Unexpected observer command: ${command}`)
  })
  vi.mocked(studioProductionClient).mockReturnValue({
    call,
    upload: vi.fn(async () => retained),
  })
  vi.mocked(studioServiceCall).mockResolvedValue(retained)
  return { state, narrate, call }
}
it.each(["finish", "attachment"])(
  "preserves accepted evidence after a lost %s response and never repeats paid generation",
  async (phase) => {
    const f = recoveryFixture()
    f.state.failFinish = phase === "finish"
    f.state.failComplete = phase === "attachment"
    expect(await executeDelegatedNarration(caller, "run")).toMatchObject({
      outcome: "RECONCILIATION_REQUIRED",
    })
    expect(f.state.call).toBe("COMPLETED")
    expect(f.state.run).toBe(phase === "finish" ? "READY" : "COMPLETED")
    await executeDelegatedNarration(caller, "run")
    expect(f.state.run).toBe("COMPLETED")
    expect(f.narrate).toHaveBeenCalledTimes(1)
    expect(
      f.call.mock.calls.some(([command]) =>
        ["fail", "preflight-error"].includes(command),
      ),
    ).toBe(false)
  },
)
it("a duplicate context failure cannot terminate another runner's live paid claim", async () => {
  const f = recoveryFixture()
  let release!: () => void
  let claimed!: () => void
  const claimedPromise = new Promise<void>((resolve) => {
    claimed = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  f.narrate.mockImplementationOnce(async () => {
    claimed()
    await gate
    return { bytes: Buffer.from("fake"), requestId: "fake", credits: 1 }
  })
  const winner = executeDelegatedNarration(caller, "run")
  await claimedPromise
  f.state.failContext = true
  expect(await executeDelegatedNarration(caller, "run")).toMatchObject({
    outcome: "RECONCILIATION_REQUIRED",
  })
  expect(f.state).toMatchObject({ run: "READY", call: "RUNNING" })
  release()
  await winner
  expect(f.state).toMatchObject({ run: "COMPLETED", call: "COMPLETED" })
  expect(f.narrate).toHaveBeenCalledTimes(1)
  expect(
    f.call.mock.calls.some(([command]) =>
      ["fail", "preflight-error"].includes(command),
    ),
  ).toBe(false)
})
