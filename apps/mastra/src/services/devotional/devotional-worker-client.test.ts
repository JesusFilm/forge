import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

import type { ProducedDevotionalAudio } from "./devotional-audio"
import {
  DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
  DEVOTIONAL_WIDE_ARTIFACT_TYPE,
  _internals,
  fetchDevotionalWorkerArtifact,
  renderDevotionalOnWorker,
} from "./devotional-worker-client"
import type { GeneratedDevotional } from "./generate-devotional"

const DEVO: GeneratedDevotional = {
  date: "2026-07-10",
  clip: { index: 19, id: "1_jf6119-0-0", title: "Jesus Calms the Storm" },
  passage: { reference: "Luke 8:22-25", osisRef: "Luke.8.22-Luke.8.25" },
  title: "Peace in the Storm",
  scripture: {
    reference: "Luke 8:24",
    text: "He rebuked the wind and the raging water; and it was calm.",
    translation: "WEB",
    needsCanonicalSource: true,
  },
  reflection: {
    text: "Christ is with you in the boat.",
    source: "Matthew Henry",
    attribution: "Adapted from Matthew Henry",
    flavor: "commentary",
  },
  reflectionHighlights: ["with you"],
  conclusion: "The One who calms the sea is in your boat.",
  question: "What storm do you need to hand to Jesus today?",
  prayer: "Jesus, calm my storm.",
  mood: "peace",
  voice: "male-d",
  sequence: 0,
}

const audio = (id: string, text: string) => ({
  id,
  text,
  audio: {
    format: "mp3" as const,
    bytes: new Uint8Array([1, 2, 3]),
    voiceId: "voice-d",
    model: "model",
    characterCount: text.length,
  },
})

const AUDIO: ProducedDevotionalAudio = {
  voice: "male-d",
  segments: [
    audio("cover", "Peace in the Storm"),
    audio("scripture", "Luke 8:24"),
    audio("reflection-1", "Reflect on this. Christ is with you."),
    audio("conclusion", DEVO.conclusion),
    audio("questions", `${DEVO.question} ${DEVO.prayer}`),
  ],
  music: null,
  skipped: [],
}

const WORKSPACE = {
  workspaceGeneration: 3,
  attemptId: "attempt_1",
  selectedSources: [
    {
      path: "/inputs/scripture/web-bible.json",
      category: "scripture" as const,
      digest: "c".repeat(64),
      size: 100,
      modifiedAt: "2026-07-31T12:00:00.000Z",
      title: "WEB Bible",
    },
  ],
}
const ATTEMPT = {
  workspaceGeneration: WORKSPACE.workspaceGeneration,
  attemptId: WORKSPACE.attemptId,
  runId: "run-1",
}
const RENDER_CONFIG = JSON.parse(
  readFileSync(
    new URL(
      "../../../devotional-workspace/inputs/render/styles.json",
      import.meta.url,
    ),
    "utf8",
  ),
)
const ATTEMPT_TOKEN = createHash("sha256")
  .update(WORKSPACE.attemptId)
  .digest("hex")
  .slice(0, 24)
const OUTPUT_ID = `dv2o_g3_${ATTEMPT_TOKEN}_${"b".repeat(64)}_99`

function workspaceUploadResponse(input: URL | RequestInfo, init?: RequestInit) {
  const match = /\/([^/]+)\.([^/.]+)$/.exec(new URL(String(input)).pathname)!
  const headers = new Headers(init?.headers)
  const artifactType = decodeURIComponent(match[1]!)
  const ext = match[2]!
  const digest = headers.get("x-content-sha256")!
  const size = Number(headers.get("x-content-size"))
  const attempt = {
    workspaceGeneration: Number(
      headers.get("x-devotional-workspace-generation"),
    ),
    attemptId: headers.get("x-devotional-attempt-id")!,
    runId: headers.get("x-devotional-run-id")!,
  }
  const attemptToken = createHash("sha256")
    .update(attempt.attemptId)
    .digest("hex")
    .slice(0, 24)
  return Response.json(
    {
      artifact: {
        schemaVersion: "2",
        key:
          artifactType === "devotional-input-manifest-v2"
            ? `runs/g${attempt.workspaceGeneration}/${attemptToken}/run-input/manifest.json`
            : `runs/g${attempt.workspaceGeneration}/${attemptToken}/run-input/${digest}/${artifactType}.${ext}`,
        digest,
        size,
        contentType: ext === "json" ? "application/json" : "audio/mpeg",
        attempt,
      },
    },
    { status: 201 },
  )
}

function videoArtifact(artifactType: string) {
  return {
    assetId: OUTPUT_ID,
    artifactType,
    ext: "mp4" as const,
    schemaVersion: "2" as const,
    key: `runs/g3/${ATTEMPT_TOKEN}/attempt-output/${"a".repeat(64)}/${
      artifactType === DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE
        ? "portrait.mp4"
        : "wide.mp4"
    }`,
    digest: "a".repeat(64),
    size: 100,
    contentType: "video/mp4",
    attempt: ATTEMPT,
  }
}

describe("devotional shorts-worker client", () => {
  it("builds a worker-owned media preparation spec without a source URL", () => {
    const spec = _internals.buildWorkerInput(
      DEVO,
      AUDIO,
      "grain",
      RENDER_CONFIG,
    )
    expect(spec.media).toMatchObject({ mediaId: DEVO.clip.id })
    expect(spec.media).not.toHaveProperty("sourceUrl")
    expect(spec.cards.map((card) => card.kind)).toEqual([
      "cover",
      "scripture",
      "video",
      "reflection-focus",
      "conclusion",
      "questions",
    ])
    expect(spec.cards.at(-1)).toMatchObject({ prayer: DEVO.prayer })
  })

  it("rejects calendar dates that JavaScript would otherwise normalize", () => {
    expect(() =>
      _internals.buildWorkerInput(
        { ...DEVO, date: "2026-02-31" },
        AUDIO,
        "grain",
        RENDER_CONFIG,
      ),
    ).toThrow("invalid devotional date 2026-02-31")
  })

  it("uploads bounded inputs, submits one job, polls, and returns both durable assets", async () => {
    const requests: { url: string; method: string; body?: string }[] = []
    let polls = 0
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? "GET"
        requests.push({
          url,
          method,
          ...(typeof init?.body === "string" ? { body: init.body } : {}),
        })
        if (method === "PUT") return workspaceUploadResponse(input, init)
        if (url.endsWith("/jobs") && method === "POST") {
          return Response.json(
            { workerJobId: "wj_1", status: "queued" },
            { status: 202 },
          )
        }
        polls += 1
        return Response.json({
          workerJobId: "wj_1",
          kind: "devotional-render",
          status: polls === 1 ? "running" : "completed",
          error: null,
          result:
            polls === 1
              ? null
              : {
                  artifacts: [
                    videoArtifact(DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE),
                    videoArtifact(DEVOTIONAL_WIDE_ARTIFACT_TYPE),
                  ],
                },
        })
      },
    )

    await expect(
      renderDevotionalOnWorker(
        {
          runId: "run-1",
          devotional: DEVO,
          audio: AUDIO,
          ...WORKSPACE,
          renderConfig: RENDER_CONFIG,
        },
        {
          baseUrl: "https://worker.example.org",
          apiKey: "secret",
          fetchImpl: fetchImpl as unknown as typeof fetch,
          pollIntervalMs: 0,
          sleep: async () => undefined,
        },
      ),
    ).resolves.toMatchObject({
      portrait: { schemaVersion: "2", digest: "a".repeat(64) },
      wide: { schemaVersion: "2", digest: "a".repeat(64) },
    })
    expect(requests.filter(({ method }) => method === "PUT")).toHaveLength(7)
    const submission = requests.find(
      ({ url, method }) => url.endsWith("/jobs") && method === "POST",
    )
    expect(JSON.parse(submission!.body!)).toMatchObject({
      kind: "devotional-render",
      runId: "run-1",
      inputAssetId: expect.stringMatching(/^dv2i_g3_/),
      outputAssetId: `dv2o_g3_${ATTEMPT_TOKEN}`,
      inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it("fails loudly if a completed job omits either aspect", async () => {
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === "PUT") return workspaceUploadResponse(input, init)
        if (url.endsWith("/jobs")) {
          return Response.json(
            { workerJobId: "wj_1", status: "queued" },
            { status: 202 },
          )
        }
        return Response.json({
          workerJobId: "wj_1",
          kind: "devotional-render",
          status: "completed",
          error: null,
          result: {
            artifacts: [videoArtifact(DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE)],
          },
        })
      },
    )
    await expect(
      renderDevotionalOnWorker(
        {
          runId: "run-1",
          devotional: DEVO,
          audio: AUDIO,
          ...WORKSPACE,
          renderConfig: RENDER_CONFIG,
        },
        {
          baseUrl: "https://worker.example.org",
          apiKey: "secret",
          fetchImpl: fetchImpl as unknown as typeof fetch,
          sleep: async () => undefined,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })

  it("rejects v2 output references bound to another attempt", () => {
    const portrait = videoArtifact(DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE)
    const wide = {
      ...videoArtifact(DEVOTIONAL_WIDE_ARTIFACT_TYPE),
      attempt: { ...ATTEMPT, attemptId: "another-attempt" },
    }

    expect(() =>
      _internals.expectedArtifacts(
        `dv2o_g3_${ATTEMPT_TOKEN}`,
        [portrait, wide],
        ATTEMPT,
      ),
    ).toThrow(/incomplete v2 video reference/u)
  })

  it("cancels the worker job when the Mastra run is aborted", async () => {
    const controller = new AbortController()
    const methods: string[] = []
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? "GET"
        methods.push(method)
        if (method === "PUT") return workspaceUploadResponse(input, init)
        if (url.endsWith("/jobs") && method === "POST") {
          return Response.json(
            { workerJobId: "wj_cancel", status: "queued" },
            { status: 202 },
          )
        }
        if (method === "DELETE") {
          return Response.json(
            { workerJobId: "wj_cancel", status: "cancelled" },
            { status: 202 },
          )
        }
        controller.abort()
        return Response.json({
          workerJobId: "wj_cancel",
          kind: "devotional-render",
          status: "running",
          error: null,
          result: null,
        })
      },
    )

    await expect(
      renderDevotionalOnWorker(
        {
          runId: "run-cancel",
          devotional: DEVO,
          audio: AUDIO,
          workspaceGeneration: 3,
          attemptId: "attempt_cancel",
          selectedSources: WORKSPACE.selectedSources,
          renderConfig: RENDER_CONFIG,
        },
        {
          baseUrl: "https://worker.example.org",
          apiKey: "secret",
          fetchImpl: fetchImpl as unknown as typeof fetch,
          abortSignal: controller.signal,
          pollIntervalMs: 0,
        },
      ),
    ).rejects.toMatchObject({ code: "job_failed", retryable: false })
    expect(methods).toContain("DELETE")
  })

  it("cancels the worker job when the poll deadline expires", async () => {
    const methods: string[] = []
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? "GET"
        methods.push(method)
        if (method === "PUT") return workspaceUploadResponse(input, init)
        if (url.endsWith("/jobs") && method === "POST") {
          return Response.json(
            { workerJobId: "wj_timeout", status: "queued" },
            { status: 202 },
          )
        }
        if (method === "DELETE") {
          return Response.json(
            { workerJobId: "wj_timeout", status: "cancelled" },
            { status: 202 },
          )
        }
        return Response.json({ error: "unexpected request" }, { status: 500 })
      },
    )

    await expect(
      renderDevotionalOnWorker(
        {
          runId: "run-timeout",
          devotional: DEVO,
          audio: AUDIO,
          workspaceGeneration: 3,
          attemptId: "attempt_timeout",
          selectedSources: WORKSPACE.selectedSources,
          renderConfig: RENDER_CONFIG,
        },
        {
          baseUrl: "https://worker.example.org",
          apiKey: "secret",
          fetchImpl: fetchImpl as unknown as typeof fetch,
          pollTimeoutMs: -1,
        },
      ),
    ).rejects.toMatchObject({ code: "job_timeout", retryable: true })
    expect(methods.at(-1)).toBe("DELETE")
  })

  it("forwards byte ranges when streaming a durable video artifact", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([2, 3]), {
          status: 206,
          headers: {
            "accept-ranges": "bytes",
            "content-range": "bytes 1-2/4",
          },
        }),
    )

    const response = await fetchDevotionalWorkerArtifact(
      {
        assetId: "devotional_output_run_1",
        artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
        ext: "mp4",
      },
      "bytes=1-2",
      {
        baseUrl: "https://worker.example.org",
        apiKey: "secret",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    )

    expect(response.status).toBe(206)
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL(
        "https://worker.example.org/artifacts/devotional_output_run_1/devotional-output-portrait-v1.mp4",
      ),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer secret",
          range: "bytes=1-2",
        }),
      }),
    )
  })
})
