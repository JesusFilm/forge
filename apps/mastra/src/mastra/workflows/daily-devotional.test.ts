import { afterEach, describe, expect, it, vi } from "vitest"

import { DevotionalArtifactError } from "../../services/devotional/artifacts"
import type { DevotionalArtifactStore } from "../../services/devotional/artifacts"
import type { DevotionalLlm } from "../../services/devotional/llm"
import type {
  Devotional,
  Hook,
  SafetyVerdict,
  ScriptureRef,
} from "../../services/devotional/types"
import {
  handleDailyDevotionalRouteRequest,
  runDailyDevotional,
} from "./daily-devotional"

const DUMMY_LLM: DevotionalLlm = {
  model: "dummy",
  complete: async () => ({}) as never,
}

const HOOK: Hook = {
  type: "question",
  title: "Where do you find peace?",
  summary: "Rest in Christ.",
  sourceUrl: null,
}
const SCRIPTURE: ScriptureRef = {
  reference: "John 14:27",
  text: "Peace I leave with you.",
  translation: "NIV",
  needsCanonicalSource: true,
}
const DEVOTIONAL: Devotional = {
  date: "2026-06-22",
  hook: HOOK,
  scripture: SCRIPTURE,
  video: null,
  videoMatch: "none",
  reflection: "Peace is the presence of Christ.",
  questions: ["Where is your fear loudest?"],
  furtherReading: null,
  blockOrder: ["hook", "scripture", "reflection", "questions"],
}
const PASS: SafetyVerdict = {
  verdict: "pass",
  scores: { doctrine: 0.9, tone: 0.9, sensitivity: 0.9 },
  reasons: [],
}
const BLOCK: SafetyVerdict = {
  verdict: "block",
  scores: { doctrine: 0.2, tone: 0.9, sensitivity: 0.9 },
  reasons: ["doctrine: off"],
}

function memStore(): DevotionalArtifactStore & {
  reports: Map<string, unknown>
  audio: Map<string, Uint8Array>
} {
  const reports = new Map<string, unknown>()
  const audio = new Map<string, Uint8Array>()
  return {
    rootDir: "/mem",
    reports,
    audio,
    async writeReport(report) {
      reports.set(report.reportId, report)
      return { path: `/mem/${report.reportId}.json` }
    },
    async writeAudio(reportId, bytes) {
      audio.set(reportId, bytes)
      return {
        path: `/mem/audio/${reportId}.mp3`,
        relativePath: `audio/${reportId}.mp3`,
      }
    },
    async readReport(reportId) {
      const found = reports.get(reportId)
      if (!found) {
        throw new DevotionalArtifactError("not_found", "missing")
      }
      return found as never
    },
  }
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    now: () => new Date("2026-06-22T07:00:00.000Z"),
    llm: DUMMY_LLM,
    safetyLlm: DUMMY_LLM,
    pickHook: async () => HOOK,
    selectScripture: async () => SCRIPTURE,
    matchVideo: async () => ({ video: null, videoMatch: "none" as const }),
    writeDevotional: async () => DEVOTIONAL,
    evaluateSafety: async () => PASS,
    publish: async () => ({ ok: true as const, published: true }),
    // Default: Azure TTS not configured, so voiceover is skipped (config_missing).
    // Tests that exercise the voiceover path override this with an ok result.
    generateVoiceover: async () => ({
      ok: false as const,
      reason: "config_missing" as const,
      retryable: false,
    }),
    artifactStore: memStore(),
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("runDailyDevotional", () => {
  it("happy path: generates, passes safety, publishes, persists", async () => {
    const store = memStore()
    const publish = vi.fn(async () => ({ ok: true as const, published: true }))
    const result = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({ artifactStore: store, publish }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.published).toBe(true)
    expect(result.safety.verdict).toBe("pass")
    expect(result.artifactPath).toBe("/mem/2026-06-22.json")
    expect(publish).toHaveBeenCalledTimes(1)
    expect(store.reports.get("2026-06-22")).toBeDefined()
  })

  it("safety block: does not publish, persists a blocked report", async () => {
    const store = memStore()
    const publish = vi.fn(async () => ({ ok: true as const, published: true }))
    const result = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({
        artifactStore: store,
        publish,
        evaluateSafety: async () => BLOCK,
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.published).toBe(false)
    expect(result.safety.verdict).toBe("block")
    expect(publish).not.toHaveBeenCalled()
    expect(store.reports.get("2026-06-22")).toMatchObject({ published: false })
  })

  it("voiceover: persists audio and records it on the report + result", async () => {
    const store = memStore()
    const generateVoiceover = vi.fn(async () => ({
      ok: true as const,
      audio: {
        format: "mp3" as const,
        bytes: new Uint8Array([1, 2, 3, 4]),
        voice: "en-US-AndrewMultilingualNeural",
        locale: "en-US",
        characterCount: 42,
      },
    }))
    const result = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({ artifactStore: store, generateVoiceover }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.voiceoverPath).toBe("audio/2026-06-22.mp3")
    expect(store.audio.get("2026-06-22")).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(store.reports.get("2026-06-22")).toMatchObject({
      voiceover: {
        format: "mp3",
        voice: "en-US-AndrewMultilingualNeural",
        artifactPath: "audio/2026-06-22.mp3",
      },
    })
  })

  it("voiceover: skipped on safety block (never narrates blocked content)", async () => {
    const store = memStore()
    const generateVoiceover = vi.fn()
    const result = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({
        artifactStore: store,
        evaluateSafety: async () => BLOCK,
        generateVoiceover,
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(generateVoiceover).not.toHaveBeenCalled()
    expect(result.voiceoverPath).toBeUndefined()
    expect(store.reports.get("2026-06-22")).toMatchObject({ voiceover: null })
  })

  it("voiceover: a TTS/persist failure never fails the run", async () => {
    const store = memStore()
    store.writeAudio = async () => {
      throw new Error("disk full")
    }
    const result = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({
        artifactStore: store,
        generateVoiceover: async () => ({
          ok: true as const,
          audio: {
            format: "mp3" as const,
            bytes: new Uint8Array([9]),
            voice: "en-US-AndrewMultilingualNeural",
            locale: "en-US",
            characterCount: 1,
          },
        }),
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.published).toBe(true)
    expect(result.voiceoverPath).toBeUndefined()
    expect(store.reports.get("2026-06-22")).toMatchObject({ voiceover: null })
  })

  it("generation failure surfaces reason + stage", async () => {
    const result = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: false },
      baseDeps({
        selectScripture: async () => {
          throw new Error("scripture model down")
        },
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "generation_failed",
      retryable: true,
      stage: "select-scripture",
    })
  })

  it("is idempotent per date: a second run does not re-publish", async () => {
    const store = memStore()
    const publish = vi.fn(async () => ({ ok: true as const, published: true }))
    const deps = baseDeps({ artifactStore: store, publish })

    const first = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      deps,
    )
    const second = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      deps,
    )

    expect(first.ok && first.published).toBe(true)
    expect(second.ok && second.published).toBe(true)
    // Published report already exists for the date -> publish skipped on rerun.
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it("short-circuits an already-published date without regenerating or overwriting", async () => {
    const store = memStore()
    await store.writeReport({
      schemaVersion: "1",
      kind: "daily-devotional",
      reportId: "2026-06-22",
      mastraRunId: "prev-run",
      date: "2026-06-22",
      startedAt: "2026-06-22T07:00:00.000Z",
      finishedAt: "2026-06-22T07:00:05.000Z",
      published: true,
      videoMatch: "none",
      safety: PASS,
      devotional: DEVOTIONAL,
    })
    const publish = vi.fn(async () => ({ ok: true as const, published: true }))
    const pickHook = vi.fn(async () => HOOK) // must NOT run on an already-published date

    const result = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({ artifactStore: store, publish, pickHook }),
    )

    expect(result.ok && result.published).toBe(true)
    expect(publish).not.toHaveBeenCalled()
    expect(pickHook).not.toHaveBeenCalled()
    // The prior run's mastraRunId is preserved — the report was not overwritten.
    expect(store.reports.get("2026-06-22")).toMatchObject({
      mastraRunId: "prev-run",
    })
  })

  it("does not fail the run when publish fails (best-effort)", async () => {
    const store = memStore()
    const result = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({
        artifactStore: store,
        publish: async () => ({
          ok: false as const,
          reason: "upstream_failed" as const,
          retryable: true,
        }),
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.published).toBe(false)
    expect(store.reports.get("2026-06-22")).toMatchObject({ published: false })
  })

  it("surfaces a non-not_found read error as artifact_failed (does not re-publish)", async () => {
    const store = memStore()
    const publish = vi.fn(async () => ({ ok: true as const, published: true }))
    store.readReport = async () => {
      throw new DevotionalArtifactError("read_failed", "io error")
    }
    const result = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({ artifactStore: store, publish }),
    )

    expect(result).toMatchObject({
      ok: false,
      reason: "artifact_failed",
      retryable: true,
    })
    expect(publish).not.toHaveBeenCalled()
  })

  it("classifies artifact write failures: write_failed retryable, invalid_artifact not", async () => {
    const withWriteError = (error: DevotionalArtifactError) => {
      const store = memStore()
      store.writeReport = async () => {
        throw error
      }
      return store
    }

    const write = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({
        artifactStore: withWriteError(
          new DevotionalArtifactError("write_failed", "disk full"),
        ),
      }),
    )
    expect(write).toMatchObject({
      ok: false,
      reason: "artifact_failed",
      retryable: true,
    })

    const invalid = await runDailyDevotional(
      { date: "2026-06-22", persistArtifact: true },
      baseDeps({
        artifactStore: withWriteError(
          new DevotionalArtifactError("invalid_artifact", "bad shape"),
        ),
      }),
    )
    expect(invalid).toMatchObject({
      ok: false,
      reason: "artifact_failed",
      retryable: false,
    })
  })

  it("rejects malformed input", async () => {
    const result = await runDailyDevotional({ date: "not-a-date" }, baseDeps())
    expect(result).toMatchObject({ ok: false, reason: "invalid_input" })
  })

  it("returns config_missing when no LLM key is configured", async () => {
    vi.resetModules()
    vi.stubEnv("OPENROUTER_API_PAID_KEY", "")
    vi.stubEnv("OPENROUTER_API_KEY", "")
    const { runDailyDevotional: fresh } = await import("./daily-devotional")
    const result = await fresh({ date: "2026-06-22", persistArtifact: false })
    expect(result).toMatchObject({ ok: false, reason: "config_missing" })
  })
})

describe("handleDailyDevotionalRouteRequest", () => {
  const serviceKeys = ["secret-key"]

  it("rejects an invalid bearer with 401", async () => {
    const outcome = await handleDailyDevotionalRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys,
      readJson: async () => ({}),
    })
    expect(outcome.status).toBe(401)
  })

  it("returns 200 for a successful run", async () => {
    const outcome = await handleDailyDevotionalRouteRequest({
      authHeader: "Bearer secret-key",
      serviceKeys,
      readJson: async () => ({ date: "2026-06-22" }),
      launch: async (_input, { runId }) => ({
        ok: true,
        mastraRunId: runId,
        date: "2026-06-22",
        published: true,
        videoMatch: "none",
        safety: PASS,
        devotional: DEVOTIONAL,
      }),
    })
    expect(outcome.status).toBe(200)
    expect(outcome.body.result?.ok).toBe(true)
  })

  it("maps invalid JSON body to 400", async () => {
    const outcome = await handleDailyDevotionalRouteRequest({
      authHeader: "Bearer secret-key",
      serviceKeys,
      readJson: async () => {
        throw new Error("bad json")
      },
    })
    expect(outcome.status).toBe(400)
  })

  it("maps config_missing to 503 and generation_failed to 502", async () => {
    const config = await handleDailyDevotionalRouteRequest({
      authHeader: "Bearer secret-key",
      serviceKeys,
      readJson: async () => ({}),
      launch: async (_input, { runId }) => ({
        ok: false,
        reason: "config_missing",
        retryable: false,
        mastraRunId: runId,
      }),
    })
    expect(config.status).toBe(503)

    const gen = await handleDailyDevotionalRouteRequest({
      authHeader: "Bearer secret-key",
      serviceKeys,
      readJson: async () => ({}),
      launch: async (_input, { runId }) => ({
        ok: false,
        reason: "generation_failed",
        retryable: true,
        mastraRunId: runId,
      }),
    })
    expect(gen.status).toBe(502)
  })

  it("maps artifact_failed to 500", async () => {
    const outcome = await handleDailyDevotionalRouteRequest({
      authHeader: "Bearer secret-key",
      serviceKeys,
      readJson: async () => ({}),
      launch: async (_input, { runId }) => ({
        ok: false,
        reason: "artifact_failed",
        retryable: false,
        mastraRunId: runId,
      }),
    })
    expect(outcome.status).toBe(500)
  })
})
