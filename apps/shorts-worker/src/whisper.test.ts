import { describe, expect, it } from "vitest"
import { parseEnv } from "./config/env.js"
import { filterHallucinatedSegments, resolveWhisperConfig } from "./whisper.js"

// Fixture mirroring whisper.cpp full-JSON segments: the typed
// TranscriptionItem surface does not declare no_speech_prob/avg_logprob,
// so the fixture mixes segments with and without them.
const fixture = [
  {
    text: "real speech",
    offsets: { from: 0, to: 900 },
    no_speech_prob: 0.05,
    avg_logprob: -0.2,
  },
  {
    text: "[music]",
    offsets: { from: 900, to: 2000 },
    no_speech_prob: 0.92,
    avg_logprob: -0.4,
  },
  {
    text: "garbled hallucination",
    offsets: { from: 2000, to: 3000 },
    no_speech_prob: 0.1,
    avg_logprob: -1.7,
  },
  {
    // Fields absent entirely (older whisper.cpp output) — must be kept.
    text: "kept without signals",
    offsets: { from: 3000, to: 4000 },
  },
  {
    // Non-numeric values must not trip the filter.
    text: "kept with junk signals",
    offsets: { from: 4000, to: 5000 },
    no_speech_prob: "high",
    avg_logprob: null,
  },
]

describe("filterHallucinatedSegments", () => {
  it("drops segments with no_speech_prob > 0.6 or avg_logprob < -1.0", () => {
    const filtered = filterHallucinatedSegments(fixture)
    expect(filtered.map((segment) => segment.text)).toEqual([
      "real speech",
      "kept without signals",
      "kept with junk signals",
    ])
  })

  it("keeps boundary values (thresholds are strict)", () => {
    const boundary = [
      { text: "exactly 0.6", no_speech_prob: 0.6 },
      { text: "exactly -1.0", avg_logprob: -1.0 },
    ]
    expect(filterHallucinatedSegments(boundary)).toHaveLength(2)
  })

  it("is pure (does not mutate its input)", () => {
    const input = [...fixture]
    filterHallucinatedSegments(input)
    expect(input).toHaveLength(fixture.length)
  })
})

describe("resolveWhisperConfig", () => {
  it("returns null when model path or cpp dir is unset", () => {
    expect(resolveWhisperConfig(parseEnv({}))).toBeNull()
    expect(
      resolveWhisperConfig(
        parseEnv({ SHORTS_WORKER_WHISPER_MODEL_PATH: "/opt/m.bin" }),
      ),
    ).toBeNull()
    expect(
      resolveWhisperConfig(
        parseEnv({ SHORTS_WORKER_WHISPER_CPP_DIR: "/opt/whisper" }),
      ),
    ).toBeNull()
  })

  it("returns the config triple when both are set", () => {
    expect(
      resolveWhisperConfig(
        parseEnv({
          SHORTS_WORKER_WHISPER_MODEL_PATH:
            "/opt/whisper-models/ggml-large-v3-turbo.bin",
          SHORTS_WORKER_WHISPER_CPP_DIR: "/opt/whisper",
        }),
      ),
    ).toEqual({
      modelPath: "/opt/whisper-models/ggml-large-v3-turbo.bin",
      whisperCppDir: "/opt/whisper",
      whisperCppVersion: "1.7.4",
    })
  })
})
