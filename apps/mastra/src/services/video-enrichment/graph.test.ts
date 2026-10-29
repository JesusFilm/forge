import { createServer } from "node:http"
import { createHash, randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createForgeVideoEnrichmentWorkflow } from "../../mastra/workflows/forge-video-enrichment"
import { runSubtitleSource } from "../subtitle-enrichment/source"
import {
  readSubtitleArtifact,
  writeSubtitleArtifact,
} from "../subtitle-enrichment/storage"
import { runTranscriptScriptureCorrectionWorkflow } from "../../mastra/workflows/transcript-scripture-correction"
import { runSubtitleEnrichmentWorkflow } from "../../mastra/workflows/subtitle-enrichment"
import { runTranscriptEmbeddingWorkflow } from "../../mastra/workflows/transcript-embedding"
import { EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS } from "../embedding-provider"
import { executeManagerEnrichmentOperation } from "../manager-enrichment-execution-client"
import {
  ManagerEnrichmentCallbackSchema,
  sendManagerEnrichmentCallback,
  type ManagerEnrichmentCallback,
} from "../manager-enrichment-callback-client"
import { executionDigest } from "../../server/enrichment-input-digest"
import { videoEnrichmentRuntime } from "./runtime"
import {
  EnrichmentSettledError,
  enrichmentProviderFetch,
} from "./provider-spend"
import type { ForgeVideoEnrichmentInput } from "../../server/forge-video-enrichment-contract"
import { runVideoEnrichmentGraph, type VideoEnrichmentGraphDeps } from "./graph"

vi.mock("../../config/env", async (original) => {
  const actual = await original<typeof import("../../config/env")>()
  return { ...actual, getOpenRouterApiKey: () => "fixture-key" }
})
const assets: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    assets.splice(0).map((assetId) =>
      rm(join(process.cwd(), ".tmp/artifacts", assetId), {
        recursive: true,
        force: true,
      }),
    ),
  )
})
const sourceSegments = [
  { start: 0, end: 3, text: "Jesus offers hope to the world." },
]
const correctionSummary = {
  status: "skipped",
  basis: "unavailable",
  contentDomain: "other",
  confidence: 0,
  checkedReferenceCount: 0,
  appliedCount: 0,
  flaggedCount: 0,
  likelyBibleReferences: [],
  findings: [],
}
function fixture(
  options: {
    failedLanguages?: string[]
    muxFailure?: boolean
    failAudio?: boolean
    sceneFailure?: boolean
    staleStage?: string
    sourceText?: string
    sourceGate?: () => Promise<void>
  } = {},
) {
  const jobId = `job-${randomUUID()}`
  const assetId = `enrichment-job-${createHash("sha256").update(jobId).digest("hex")}`
  const segments = options.sourceText
    ? sourceSegments.map((segment) => ({
        ...segment,
        text: options.sourceText!,
      }))
    : sourceSegments
  assets.push(assetId)
  const input: ForgeVideoEnrichmentInput = {
    jobId,
    assetId,
    muxAssetId: "mux-fixture",
    playbackId: "playback-fixture",
    language: "en",
    translateTo: ["fr", "es"],
  }
  const callbacks: ManagerEnrichmentCallback[] = []
  const operations: { kind: string; stage?: string }[] = []
  const ledger = new Map<
    string,
    { digest: string; token: string; completed: boolean }
  >()
  let terminal: string | undefined
  let reportPersisted = false
  let publicationResults: unknown
  const bridgeFetch: typeof fetch = async (url, init) => {
    expect(init?.redirect).toBe("error")
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer fixture-bearer",
    )
    const raw = JSON.parse(String(init?.body))
    expect(raw.jobId).toBe(input.jobId)
    expect(raw.runId).toBe("graph-run")
    if (String(url).endsWith("enrichment-callback")) {
      const parsed = ManagerEnrichmentCallbackSchema.parse(raw)
      callbacks.push(parsed)
      // Transport/schema integration fixture: persisted projection is a fake,
      // not Admin GraphQL CAS or a production callback endpoint.
      if (parsed.jobStatus) {
        expect([...ledger.values()].every((entry) => entry.completed)).toBe(
          true,
        )
        terminal = parsed.jobStatus
      }
      return Response.json({ ok: true, action: "applied" })
    }
    expect(raw.inputDigest).toBe(executionDigest(input))
    const operation = raw.operation
    operations.push(operation)
    if (operation.kind === "mastra-stage-claim") {
      if (operation.stage === options.staleStage)
        return Response.json({ error: "stale" }, { status: 409 })
      expect(operation.stageDigest).toMatch(/^[a-f0-9]{64}$/)
      const old = ledger.get(operation.stage)
      if (old) return Response.json({ error: "consumed" }, { status: 409 })
      const token = randomUUID()
      ledger.set(operation.stage, {
        digest: operation.stageDigest,
        token,
        completed: false,
      })
      return Response.json({
        ok: true,
        result: { status: "claimed", claimToken: token },
      })
    }
    if (operation.kind === "mastra-stage-complete") {
      const entry = ledger.get(operation.stage)!
      expect(entry.digest).toBe(operation.stageDigest)
      expect(entry.token).toBe(operation.claimToken)
      entry.completed = true
      return Response.json({
        ok: true,
        result: { status: "replayed", result: operation.result },
      })
    }
    if (operation.kind === "apply-transcript-corrections") {
      await writeSubtitleArtifact({
        assetId,
        artifactType: "transcript-correction-report",
        ext: "json",
        body: JSON.stringify(correctionSummary),
      })
      return Response.json({
        ok: true,
        result: {
          artifactKeys: ["transcript-correction-report"],
          summary: correctionSummary,
          changed: false,
        },
      })
    }
    if (operation.kind === "mux-publication") {
      publicationResults = operation.languageResults
      reportPersisted = true
      return Response.json({
        ok: true,
        result: {
          report: {
            comparisons: options.muxFailure
              ? [{ status: "failed", explanation: "Mux comparison failed" }]
              : [],
          },
        },
      })
    }
    if (operation.kind === "audio-cleanup") {
      if (options.failAudio) throw new Error("Cleanup response lost")
      return Response.json({
        ok: true,
        result: { artifactKeys: ["original-audio", "cleaned-audio"] },
      })
    }
    throw new Error(`Unexpected operation ${operation.kind}`)
  }
  const providerFetch = vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    const name = request.response_format.json_schema.name
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify(
              name === "chapters_outline"
                ? {
                    chapters: [
                      {
                        title: "Hope for the world",
                        startSeconds: 0,
                        summary: "Jesus offers hope.",
                      },
                    ],
                  }
                : name === "video_metadata"
                  ? {
                      title: "Hope for the World",
                      description: "Jesus offers hope to everyone.",
                      topics: ["hope"],
                      speakers: ["Jesus"],
                      tags: ["hope"],
                      language: "en",
                    }
                  : {
                      inputQuality: "good",
                      themes: ["hope"],
                      content: "Jesus offers hope.",
                      tone: "reflective",
                      bibleVerses: [],
                      demographics: [],
                      spiritualContext: [],
                    },
            ),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    })
  })
  const nativeFetch = fetch
  vi.stubGlobal("fetch", providerFetch)
  const runtime: VideoEnrichmentGraphDeps["runtime"] = {
    ...videoEnrichmentRuntime,
    source: vi.fn((sourceInput) =>
      runSubtitleSource(sourceInput, {
        readMuxSource: async () => {
          await options.sourceGate?.()
          return { segments, language: "en" }
        },
      }),
    ),
    correction: (correctionInput, runOptions) =>
      runTranscriptScriptureCorrectionWorkflow(correctionInput, {
        ...runOptions,
        apiKey: "",
        detectScriptureContext: async () => ({
          contentDomain: "other",
          confidence: 0,
          likelyBibleReferences: [],
        }),
      }),
    translation: (translationInput, runOptions) =>
      runSubtitleEnrichmentWorkflow(translationInput, {
        ...runOptions,
        apiKey: "fixture",
        deps: {
          ...runOptions?.deps,
          loadConfig: async () => undefined,
          detectScriptureContext: async () => ({
            contentDomain: "other",
            confidence: 0,
            likelyBibleReferences: [],
          }),
          translate: async ({ targetLanguage }) => {
            if (options.failedLanguages?.includes(targetLanguage))
              throw new EnrichmentSettledError("Definite translation refusal")
            return {
              text: options.sourceText ?? "Jesus offre de l'espoir.",
              usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            }
          },
          retime: async () => ({
            fallbackUsed: false,
            segments: segments.map((segment) => ({
              ...segment,
              text: options.sourceText ?? "Jesus offre de l'espoir.",
            })),
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          }),
        },
      }),
    embeddings: (embeddingInput, runOptions) =>
      runTranscriptEmbeddingWorkflow(embeddingInput, {
        ...runOptions,
        embeddingsBaseUrl: "https://fixture.invalid/v1",
        apiKey: "fixture",
        embeddingRequester: async (texts) => ({
          embeddings: texts.map(() =>
            Array(EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS).fill(0.1),
          ),
          dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
          tokenCount: 3,
          model: "embeddings",
          provider: "fixture",
          requestModel: "embeddings",
        }),
        adminIngestClient: async (payload) => ({
          ok: true,
          result: {
            status: "created",
            target: {
              videoId: "v",
              videoEditionId: "e",
              coreId: "c",
              language: payload.language,
            },
            chunks: payload.chunks.length,
            model: payload.model.name,
            dimensions: payload.model.dimensions,
            mastraRunId: payload.generation.mastraRunId,
          },
        }),
      }),
    ...(options.sceneFailure
      ? {
          scene: async () => {
            throw new EnrichmentSettledError(
              "Definitively invalid optional scene",
            )
          },
        }
      : {}),
  }
  const deps: VideoEnrichmentGraphDeps = {
    runtime,
    execute: (request) =>
      executeManagerEnrichmentOperation(request, {
        fetchImpl: bridgeFetch,
        callbackUrl: "https://fixture.invalid/api/internal/enrichment-callback",
        bearer: "fixture-bearer",
      }),
    callback: (callback) =>
      sendManagerEnrichmentCallback(callback, {
        fetchImpl: bridgeFetch,
        callbackUrl: "https://fixture.invalid/api/internal/enrichment-callback",
        bearer: "fixture-bearer",
      }),
  }
  return {
    input,
    deps,
    callbacks,
    operations,
    ledger,
    providerFetch,
    bridgeFetch,
    nativeFetch,
    status: () => terminal,
    report: () => reportPersisted,
    publication: () => publicationResults,
  }
}

describe("committed enrichment graph", () => {
  it("runs two committed graphs sharing one Mux asset with overlapping real source and leaf artifact writes", async () => {
    let arrivals = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sourceGate = async () => {
      if (++arrivals === 2) release()
      await gate
    }
    const left = fixture({ sourceText: "Left job source only", sourceGate })
    const right = fixture({ sourceText: "Right job source only", sourceGate })
    expect(left.input.muxAssetId).toBe(right.input.muxAssetId)
    expect(left.input.assetId).not.toBe(right.input.assetId)
    for (const f of [left, right])
      f.deps.runtime.embeddings = vi.fn(f.deps.runtime.embeddings)
    const runs = await Promise.all(
      [left, right].map(async (f) => {
        const run = await createForgeVideoEnrichmentWorkflow(f.deps).createRun({
          runId: "graph-run",
        })
        return run.start({ inputData: f.input })
      }),
    )
    expect(arrivals).toBe(2)
    expect(runs.map((r) => r.status)).toEqual(["success", "success"])
    for (const [f, text, foreign] of [
      [left, "Left job source only", "Right job source only"],
      [right, "Right job source only", "Left job source only"],
    ] as const) {
      for (const [artifact, ext] of [
        ["transcript", "json"],
        ["subtitles", "vtt"],
        ["subtitles-fr", "vtt"],
        ["translation-fr", "json"],
      ]) {
        const body = Buffer.from(
          await readSubtitleArtifact(f.input.assetId, artifact, ext),
        ).toString()
        expect(body).toContain(text)
        expect(body).not.toContain(foreign)
      }
      for (const [artifact, ext] of [
        ["chapters", "json"],
        ["chapters-vtt", "vtt"],
        ["metadata", "json"],
      ]) {
        expect(
          (await readSubtitleArtifact(f.input.assetId, artifact, ext))
            .byteLength,
        ).toBeGreaterThan(0)
      }
      expect(f.deps.runtime.embeddings).toHaveBeenCalledWith(
        expect.objectContaining({
          target: {
            external: {
              assetId: f.input.assetId,
              muxAssetId: f.input.muxAssetId,
            },
          },
        }),
        expect.any(Object),
      )
      expect(f.ledger.get("embeddings")?.completed).toBe(true)
      expect(f.status()).toBe("completed")
    }
  })

  it("reuses a declared owned transcript when automatic intent allows reuse", async () => {
    const f = fixture()
    await writeSubtitleArtifact({
      assetId: f.input.assetId,
      artifactType: "transcript",
      ext: "json",
      body: JSON.stringify({
        language: "en",
        segments: [{ start: 0, end: 3, text: "Verified own source" }],
      }),
    })
    f.input.initialArtifacts = { transcript: { kind: "downloadable" } }
    f.input.requestedTranscriptionProvider = "automatic"
    await runVideoEnrichmentGraph(f.input, "graph-run", f.deps)
    expect(f.deps.runtime.source).toHaveBeenCalledWith(
      expect.objectContaining({ source: { kind: "transcript_artifact" } }),
    )
    expect(
      Buffer.from(
        await readSubtitleArtifact(f.input.assetId, "transcript", "json"),
      ).toString(),
    ).toContain("Verified own source")
  })

  it("forces real Mux acquisition through the committed workflow despite a retained transcript", async () => {
    const f = fixture()
    await writeSubtitleArtifact({
      assetId: f.input.assetId,
      artifactType: "transcript",
      ext: "json",
      body: JSON.stringify({
        language: "en",
        segments: [{ start: 0, end: 3, text: "OLD SOURCE" }],
      }),
    })
    f.input.initialArtifacts = {
      transcript: { kind: "downloadable" },
      subtitles: { kind: "downloadable" },
    }
    f.input.requestedTranscriptionProvider = "mux"
    const run = await createForgeVideoEnrichmentWorkflow(f.deps).createRun({
      runId: "graph-run",
    })
    const result = await run.start({ inputData: f.input })
    expect(result.status).toBe("success")
    expect(f.deps.runtime.source).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "mux", muxAssetId: f.input.muxAssetId },
      }),
    )
    expect(
      JSON.parse(
        Buffer.from(
          await readSubtitleArtifact(f.input.assetId, "transcript", "json"),
        ).toString(),
      ).segments,
    ).toEqual(sourceSegments)
  })

  it("executes real leaf services, persisted artifacts and callback/bridge transport adapters", async () => {
    const f = fixture()
    f.input.runSceneAnalysis = true
    // Actual local HTTP exercises streaming, bearer/JSON framing and bounded
    // production client acknowledgement reads. The ledger/state handlers are
    // deterministic integration adapters; this is not Admin persistence proof.
    const server = createServer(async (request, response) => {
      try {
        const body: Buffer[] = []
        for await (const chunk of request) body.push(Buffer.from(chunk))
        const result = await f.bridgeFetch(
          `https://fixture.invalid${request.url}`,
          {
            method: request.method,
            redirect: "error",
            headers: { authorization: String(request.headers.authorization) },
            body: Buffer.concat(body).toString(),
          },
        )
        response.writeHead(result.status, {
          "content-type": "application/json",
        })
        response.end(await result.text())
      } catch {
        response.writeHead(500)
        response.end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string")
      throw new Error("No local server address")
    const callbackUrl = `http://127.0.0.1:${address.port}/api/internal/enrichment-callback`
    const options = {
      callbackUrl,
      bearer: "fixture-bearer",
      fetchImpl: f.nativeFetch,
    }
    const deps = {
      ...f.deps,
      execute: (
        request: Parameters<typeof executeManagerEnrichmentOperation>[0],
      ) => executeManagerEnrichmentOperation(request, options),
      callback: (callback: ManagerEnrichmentCallback) =>
        sendManagerEnrichmentCallback(callback, options),
    }
    let result
    try {
      const run = await createForgeVideoEnrichmentWorkflow(deps).createRun({
        runId: "graph-run",
      })
      result = await run.start({ inputData: f.input })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
    expect(result.status).toBe("success")
    expect(f.status()).toBe("completed")
    expect(f.report()).toBe(true)
    expect(f.publication()).toEqual([
      { lang: "fr", status: "completed" },
      { lang: "es", status: "completed" },
    ])
    for (const [type, ext] of [
      ["transcript", "json"],
      ["subtitles", "vtt"],
      ["transcript-correction-report", "json"],
      ["subtitles-fr", "vtt"],
      ["translation-fr", "json"],
      ["chapters", "json"],
      ["chapters-vtt", "vtt"],
      ["metadata", "json"],
      ["scene-boundaries", "json"],
      ["scene-analysis", "json"],
    ]) {
      expect(
        (await readSubtitleArtifact(f.input.assetId, type, ext)).length,
      ).toBeGreaterThan(0)
    }
    expect(
      f.callbacks.find(
        (c) => c.step === "structured_transcript" && c.status === "completed",
      ),
    ).toMatchObject({
      details: { transcriptCorrection: { status: "skipped" } },
    })
    expect(
      f.callbacks.find(
        (c) => c.step === "embeddings" && c.status === "completed",
      ),
    ).toMatchObject({ details: { mastra: { chunks: 1, status: "created" } } })
    const starts = f.operations
      .filter((o) => o.kind === "mastra-stage-claim")
      .map((o) => o.stage)
    expect(starts).toEqual([
      "source",
      "correction",
      "translation",
      "chapters",
      "metadata",
      "embeddings",
      "scene-analysis",
    ])
  })
  it("preserves partial-language success through Mux publication", async () => {
    const f = fixture({ failedLanguages: ["es"] })
    await runVideoEnrichmentGraph(f.input, "graph-run", f.deps)
    expect(f.status()).toBe("completed")
    expect(f.publication()).toMatchObject([
      { lang: "fr", status: "completed" },
      { lang: "es", status: "failed" },
    ])
  })
  it("settles every parallel branch before aggregate all-language failure", async () => {
    const f = fixture({ failedLanguages: ["fr", "es"] })
    await expect(
      runVideoEnrichmentGraph(f.input, "graph-run", f.deps),
    ).rejects.toThrow("all_languages_failed")
    expect(f.status()).toBe("failed")
    expect(f.report()).toBe(false)
    expect(
      f.callbacks.filter((c) => c.status === "completed").map((c) => c.step),
    ).toEqual(expect.arrayContaining(["chapters", "metadata", "embeddings"]))
    expect([...f.ledger.values()].every((entry) => entry.completed)).toBe(true)
  })
  it("persists Mux report before comparison failure", async () => {
    const f = fixture({ muxFailure: true })
    await expect(
      runVideoEnrichmentGraph(f.input, "graph-run", f.deps),
    ).rejects.toThrow("Mux comparison failed")
    expect(f.report()).toBe(true)
    expect(f.status()).toBe("failed")
  })
  it("isolates definitively settled optional scene failure", async () => {
    const f = fixture({ sceneFailure: true })
    f.input.runSceneAnalysis = true
    await runVideoEnrichmentGraph(f.input, "graph-run", f.deps)
    expect(f.status()).toBe("completed")
    expect(f.ledger.get("scene-analysis")?.completed).toBe(true)
  })
  it("fails requested cleanup before source; lost response stays consumed", async () => {
    const f = fixture({ failAudio: true })
    f.input.runAudioCleanup = true
    await expect(
      runVideoEnrichmentGraph(f.input, "graph-run", f.deps),
    ).rejects.toThrow("Cleanup response lost")
    expect(f.deps.runtime.source).not.toHaveBeenCalled()
    expect(f.status()).toBeUndefined()
    expect(f.callbacks.at(-1)).toMatchObject({
      step: "audio_cleanup",
      status: "failed",
    })
  })
  it("denies a stale owner immediately before later spend", async () => {
    const f = fixture({ staleStage: "metadata" })
    const metadata = vi.spyOn(f.deps.runtime, "metadata")
    await expect(
      runVideoEnrichmentGraph(f.input, "graph-run", f.deps),
    ).rejects.toThrow(/ownership|409/)
    expect(metadata).not.toHaveBeenCalled()
    expect(f.status()).toBeUndefined()
    expect(f.report()).toBe(false)
  })
  it("keeps a swallowed transport timeout consumed and waits for siblings", async () => {
    const f = fixture()
    f.deps.runtime.translation = async (_input, options) => {
      await enrichmentProviderFetch(async () => {
        throw new Error("timeout")
      }, "https://fixture.invalid").catch(() => {})
      return {
        ok: true,
        mastraRunId: options?.runId ?? "r",
        succeeded: 1,
        failed: 0,
        languages: [],
      }
    }
    await expect(
      runVideoEnrichmentGraph(f.input, "graph-run", f.deps),
    ).rejects.toThrow("ambiguous")
    expect(f.ledger.get("translation")?.completed).toBe(false)
    expect(f.status()).toBeUndefined()
    expect(
      f.callbacks.filter((c) => c.status === "completed").map((c) => c.step),
    ).toEqual(expect.arrayContaining(["chapters", "metadata", "embeddings"]))
  })
  it("does not spend after a dropped ownership callback", async () => {
    const f = fixture()
    f.deps.callback = async () => {
      throw new Error("ownership_lost")
    }
    await expect(
      runVideoEnrichmentGraph(f.input, "graph-run", f.deps),
    ).rejects.toThrow("ownership_lost")
    expect(f.operations).toEqual([])
    expect(f.providerFetch).not.toHaveBeenCalled()
  })
  it("fails explicit ElevenLabs and automatic language honestly before spend", async () => {
    for (const unsupported of [
      { requestedTranscriptionProvider: "elevenlabs" as const },
      { language: "auto" },
    ]) {
      const f = fixture()
      Object.assign(f.input, unsupported)
      await expect(
        runVideoEnrichmentGraph(f.input, "graph-run", f.deps),
      ).rejects.toThrow(/legacy|explicit source language/)
      expect(f.operations).toEqual([])
      expect(f.status()).toBe("failed")
    }
  })
})
