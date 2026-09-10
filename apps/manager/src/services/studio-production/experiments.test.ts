import { beforeEach, expect, it, vi } from "vitest"
import { experimentQuote, executeStudioExperiment } from "./experiments"
import { studioProductionClient } from "./transport"
import { ElevenStudioProvider } from "./provider"
const testEnv = vi.hoisted(() => ({
  STUDIO_PRODUCTION_RATE_CARD: undefined as string | undefined,
  ELEVENLABS_API_KEY: "test-only",
}))
vi.mock("@/config/env", () => ({ env: testEnv }))
vi.mock("./transport", () => ({ studioProductionClient: vi.fn() }))
vi.mock("./audio", () => ({
  measureStudioAudio: vi.fn().mockResolvedValue(1000),
}))
const call = vi.fn(),
  upload = vi.fn(),
  interactive = vi.fn()
const card = {
  basis: "Verified test account only",
  verifiedUntil: "2099-01-01T00:00:00.000Z",
  narration: [],
  music: [
    { model: "music_v1", maxDurationMs: 10000, microsPerGeneration: 150000 },
  ],
  voice: [
    {
      model: "eleven_multilingual_ttv_v2",
      microsPerPreviewCharacter: 100,
      registrationMicros: 5000,
    },
  ],
}
const draft = {
  kind: "music",
  provider: "elevenlabs",
  model: "music_v1",
  language: "en",
  prompt: "Gentle instrumental piano",
  candidateCount: 2,
  settings: { lengthMs: 10000, instrumental: true },
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  testEnv.STUDIO_PRODUCTION_RATE_CARD = JSON.stringify(card)
  vi.mocked(studioProductionClient).mockReturnValue({ call, upload })
  upload.mockImplementation(async (metadata) => ({
    reference: {
      assetId: metadata.idempotencyKey,
      versionId: "version",
      digest: "a".repeat(64),
    },
  }))
})
it("refuses missing account rates and unbounded duration without a paid probe", () => {
  testEnv.STUDIO_PRODUCTION_RATE_CARD = undefined
  expect(() => experimentQuote(draft)).toThrow("Verified account rates")
  testEnv.STUDIO_PRODUCTION_RATE_CARD = JSON.stringify(card)
  expect(() =>
    experimentQuote({
      ...draft,
      settings: { ...draft.settings, lengthMs: 20000 },
    }),
  ).toThrow("No verified music")
  expect(call).not.toHaveBeenCalled()
})
it("claims each fixed music request once and retains all candidates with unknown actual charges", async () => {
  const quote = experimentQuote(draft),
    spec = {
      ...draft,
      estimate: quote.estimate,
      maxCostMicros: 300000,
      confirmed: true,
      idempotencyKey: "music-request",
    }
  const claimed = new Set<string>()
  call.mockImplementation(async (command, input) => {
    if (command === "context")
      return {
        run: { state: "READY" },
        experiment: { id: "experiment", request: spec },
      }
    if (command === "claim") {
      const execute = !claimed.has(input.key)
      claimed.add(input.key)
      return { execute, call: { state: execute ? "RUNNING" : "COMPLETED" } }
    }
    return {}
  })
  const music = vi
    .spyOn(ElevenStudioProvider.prototype, "music")
    .mockResolvedValue({
      bytes: Buffer.from("retained fixture"),
      requestId: "provider-request",
      songId: null,
      credits: null,
    })
  await executeStudioExperiment("operator", interactive, "run")
  await executeStudioExperiment("operator", interactive, "run")
  expect(music).toHaveBeenCalledTimes(2)
  expect(music).toHaveBeenCalledWith({
    prompt: draft.prompt,
    model: draft.model,
    lengthMs: 10000,
    instrumental: true,
  })
  expect(upload).toHaveBeenCalledTimes(2)
  expect(
    call.mock.calls.filter(([command]) => command === "experiment-candidate"),
  ).toHaveLength(2)
  expect(
    call.mock.calls
      .filter(([command]) => command === "finish")
      .every(([, input]) => input.result.actualCostMicros === null),
  ).toBe(true)
})
it("retains a changed-rate preflight failure without invoking the provider", async () => {
  const estimate = experimentQuote(draft).estimate
  call.mockImplementation(async (command) =>
    command === "context"
      ? {
          run: { state: "READY" },
          experiment: {
            id: "experiment",
            request: {
              ...draft,
              estimate,
              maxCostMicros: estimate.amountMicros,
              confirmed: true,
              idempotencyKey: "preflight",
            },
          },
        }
      : {},
  )
  const music = vi.spyOn(ElevenStudioProvider.prototype, "music")
  testEnv.STUDIO_PRODUCTION_RATE_CARD = undefined
  await expect(
    executeStudioExperiment("operator", interactive, "run"),
  ).rejects.toThrow("Verified account rates")
  expect(music).not.toHaveBeenCalled()
  expect(call).toHaveBeenCalledWith("preflight-error", {
    diagnostic:
      "Verified account rates are required before a creative experiment",
  })
})
it("preserves preview language provenance instead of registering a wrong-language voice", async () => {
  const voice = {
    ...draft,
    kind: "voice",
    model: "eleven_multilingual_ttv_v2",
    candidateCount: 3,
    settings: {
      text: "A".repeat(120),
      loudness: 0.5,
      guidanceScale: 5,
      languageCode: "en",
      narrationModel: "eleven_multilingual_v2",
    },
  }
  const spec = {
    ...voice,
    estimate: experimentQuote(voice).estimate,
    maxCostMicros: 17000,
    confirmed: true,
    idempotencyKey: "voice-request",
  }
  call.mockImplementation(async (command) =>
    command === "context"
      ? {
          run: { state: "READY" },
          experiment: { id: "experiment", request: spec },
        }
      : command === "claim"
        ? { execute: true, call: { state: "RUNNING" } }
        : {},
  )
  vi.spyOn(ElevenStudioProvider.prototype, "designVoice").mockResolvedValue({
    requestId: "provider",
    credits: null,
    text: voice.settings.text,
    candidates: ["en", "fr", "en"].map((language, i) => ({
      bytes: Buffer.from("audio"),
      voiceId: `candidate-${i}`,
      language,
      durationMs: 1000,
    })),
  })
  await executeStudioExperiment("operator", interactive, "run")
  expect(upload).toHaveBeenCalledTimes(3)
  expect(upload.mock.calls[1][0].provenance.recorded).toMatchObject({
    providerObservedLanguage: "fr",
    languageMatch: false,
  })
})
