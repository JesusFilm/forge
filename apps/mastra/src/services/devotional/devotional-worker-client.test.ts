import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

import type { ProducedDevotionalAudio } from "./devotional-audio"
import {
  DEVOTIONAL_INPUT_ARTIFACT_TYPE,
  DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
  DEVOTIONAL_WIDE_ARTIFACT_TYPE,
  _internals,
  fetchDevotionalWorkerArtifact,
  renderDevotionalOnWorker,
  verifyDevotionalWorkerArtifacts,
} from "./devotional-worker-client"
import type { GeneratedDevotional } from "./generate-devotional"
import type { DevotionalWorkspaceMediaStore } from "./workspace/media-store"

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

function videoArtifact(
  artifactType:
    | typeof DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE
    | typeof DEVOTIONAL_WIDE_ARTIFACT_TYPE,
) {
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

function canonicalVideoRef(
  artifactType:
    | typeof DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE
    | typeof DEVOTIONAL_WIDE_ARTIFACT_TYPE,
) {
  const artifact = videoArtifact(artifactType)
  return {
    schemaVersion: artifact.schemaVersion,
    key: artifact.key,
    digest: artifact.digest,
    size: artifact.size,
    contentType: artifact.contentType,
    attempt: artifact.attempt,
  }
}

function cleanupStore(discardUpload: ReturnType<typeof vi.fn>) {
  const unavailable = async (): Promise<never> => {
    throw new Error("not used")
  }
  const store: DevotionalWorkspaceMediaStore = {
    supportsSignedTransfers: true,
    async writeImmutableArtifact(input) {
      const body = Buffer.from(input.body)
      return {
        schemaVersion: "2",
        key: input.key,
        digest: createHash("sha256").update(body).digest("hex"),
        size: body.byteLength,
        contentType: input.contentType,
        attempt: input.attempt,
      }
    },
    async createReadGrant(ref) {
      return {
        ref,
        url: `https://workspace.example/${ref.key}?signed=secret`,
        expiresAt: "2030-01-01T00:00:00.000Z",
      }
    },
    async createUploadGrant({ attempt, uploadId, fileName }) {
      const token = createHash("sha256")
        .update(attempt.attemptId)
        .digest("hex")
        .slice(0, 24)
      return {
        key: `runs/g${attempt.workspaceGeneration}/${token}/worker-upload/${uploadId}/${fileName}`,
        contentType: "video/mp4",
        url: `https://workspace.example/${fileName}?signed=secret`,
        expiresAt: "2030-01-01T00:00:00.000Z",
      }
    },
    finalizeUpload: unavailable,
    verifyArtifact: unavailable,
    readManifest: unavailable,
    readAttemptOutput: async () => null,
    discardUpload,
    fetchArtifact: unavailable,
  }
  return store
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

  it("writes inputs through Mastra and submits only short-lived Workspace capabilities", async () => {
    const objects = new Map<string, Buffer>()
    const store: DevotionalWorkspaceMediaStore = {
      supportsSignedTransfers: true,
      async writeImmutableArtifact(input) {
        const body =
          typeof input.body === "string"
            ? Buffer.from(input.body)
            : Buffer.from(input.body)
        objects.set(input.key, body)
        return {
          schemaVersion: "2",
          key: input.key,
          digest: createHash("sha256").update(body).digest("hex"),
          size: body.byteLength,
          contentType: input.contentType,
          attempt: input.attempt,
        }
      },
      async createReadGrant(ref) {
        return {
          ref,
          url: `https://workspace.example/${encodeURIComponent(ref.key)}?signed=secret`,
          expiresAt: "2030-01-01T00:00:00.000Z",
        }
      },
      async createUploadGrant({ attempt, uploadId, fileName }) {
        return {
          key: `runs/g${attempt.workspaceGeneration}/${ATTEMPT_TOKEN}/worker-upload/${uploadId}/${fileName}`,
          contentType: "video/mp4",
          url: `https://workspace.example/${fileName}?signed=secret`,
          expiresAt: "2030-01-01T00:00:00.000Z",
        }
      },
      async finalizeUpload({ digest, size, attempt, fileName }) {
        return {
          schemaVersion: "2",
          key: `runs/g${attempt.workspaceGeneration}/${ATTEMPT_TOKEN}/attempt-output/${digest}/${fileName}`,
          digest,
          size,
          contentType: "video/mp4",
          attempt,
        }
      },
      async verifyArtifact() {},
      async readManifest(input) {
        return (
          objects.get(
            `runs/g${input.workspaceGeneration}/${input.attemptToken}/${input.kind}/manifest.json`,
          ) ?? Buffer.alloc(0)
        )
      },
      async readAttemptOutput() {
        return null
      },
      async discardUpload() {},
      async fetchArtifact() {
        return new Response("video")
      },
    }
    const submissions: Record<string, unknown>[] = []
    const pollUrls: string[] = []
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/jobs") && init?.method === "POST") {
          submissions.push(
            JSON.parse(String(init.body)) as Record<string, unknown>,
          )
          return Response.json(
            {
              workerJobId: `wj_signed_${submissions.length}`,
              status: "queued",
            },
            { status: 202 },
          )
        }
        pollUrls.push(url)
        if (submissions.length === 1) {
          return Response.json({ error: "not_found" }, { status: 404 })
        }
        const transfer = submissions[0]?.workspaceTransfer as {
          attempt: typeof ATTEMPT
          outputs: Array<{
            artifactType: string
            key: string
            contentType: string
          }>
        }
        return Response.json({
          workerJobId: `wj_signed_${submissions.length}`,
          kind: "devotional-render",
          status: "completed",
          error: null,
          result: {
            artifacts: transfer.outputs.map((output, index) => ({
              assetId: `dv2o_g3_${ATTEMPT_TOKEN}`,
              artifactType: output.artifactType,
              ext: "mp4",
              schemaVersion: "2",
              key: output.key,
              digest: (index === 0 ? "a" : "b").repeat(64),
              size: 100 + index,
              contentType: output.contentType,
              attempt: transfer.attempt,
            })),
          },
        })
      },
    )

    const result = await renderDevotionalOnWorker(
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
        workspaceMediaStore: store,
      },
    )
    await renderDevotionalOnWorker(
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
        workspaceMediaStore: store,
      },
    )

    expect(result.portrait.key).toContain("/attempt-output/")
    expect(objects.size).toBe(8)
    expect(submissions).toHaveLength(3)
    expect(submissions[1]).toEqual(submissions[0])
    expect(pollUrls).toEqual([
      "https://worker.example.org/jobs/wj_signed_1",
      "https://worker.example.org/jobs/wj_signed_2",
      "https://worker.example.org/jobs/wj_signed_3",
    ])
    expect(
      (
        submissions[2]?.workspaceTransfer as {
          outputs: Array<{ key: string }>
        }
      ).outputs.map(({ key }) => key),
    ).toEqual(
      (
        submissions[0]?.workspaceTransfer as {
          outputs: Array<{ key: string }>
        }
      ).outputs.map(({ key }) => key),
    )
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining("/devotional-inputs/"),
      expect.anything(),
    )
    expect(submissions[0]).toMatchObject({
      kind: "devotional-render",
      workspaceTransfer: {
        schemaVersion: "1",
        manifest: { url: expect.stringContaining("?signed=secret") },
        inputs: expect.arrayContaining([
          expect.objectContaining({
            artifactType: DEVOTIONAL_INPUT_ARTIFACT_TYPE,
            url: expect.stringContaining("?signed=secret"),
          }),
        ]),
        outputs: expect.arrayContaining([
          expect.objectContaining({
            artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
            url: expect.stringContaining("?signed=secret"),
          }),
        ]),
      },
    })
  })

  it("bounds signed job resubmission when Worker restarts keep losing the job", async () => {
    const discardUpload = vi.fn(async () => undefined)
    const fetchImpl = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Response.json(
            {
              workerJobId: `wj_lost_${fetchImpl.mock.calls.length}`,
              status: "queued",
            },
            { status: 202 },
          )
        }
        return Response.json({ error: "not_found" }, { status: 404 })
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
          workspaceMediaStore: cleanupStore(discardUpload),
          pollIntervalMs: 0,
          sleep: async () => undefined,
        },
      ),
    ).rejects.toMatchObject({
      code: "invalid_response",
      retryable: false,
    })

    expect(
      fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(3)
    expect(discardUpload).toHaveBeenCalledTimes(4)
  })

  it("returns a verified completed signed attempt without resubmitting it", async () => {
    const manifest = {
      schemaVersion: "2" as const,
      kind: "attempt-output" as const,
      attempt: ATTEMPT,
      artifacts: [
        {
          artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
          ext: "mp4",
          ref: canonicalVideoRef(DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE),
        },
        {
          artifactType: DEVOTIONAL_WIDE_ARTIFACT_TYPE,
          ext: "mp4",
          ref: canonicalVideoRef(DEVOTIONAL_WIDE_ARTIFACT_TYPE),
        },
      ],
    }
    const store: DevotionalWorkspaceMediaStore = {
      ...cleanupStore(vi.fn(async () => undefined)),
      readAttemptOutput: async () => ({
        manifestRef: {
          schemaVersion: "2",
          key: `runs/g3/${ATTEMPT_TOKEN}/attempt-output/manifest.json`,
          digest: "d".repeat(64),
          size: 123,
          contentType: "application/json",
          attempt: ATTEMPT,
        },
        manifest,
      }),
    }
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw new Error("completed attempts must not call shorts-worker")
    })

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
          workspaceMediaStore: store,
        },
      ),
    ).resolves.toMatchObject({
      portrait: {
        assetId: `dv2o_g3_${ATTEMPT_TOKEN}_${"d".repeat(64)}_123`,
      },
      wide: {
        assetId: `dv2o_g3_${ATTEMPT_TOKEN}_${"d".repeat(64)}_123`,
      },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("keeps polling an active job after a transient status failure", async () => {
    const methods: string[] = []
    let polls = 0
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? "GET"
        methods.push(method)
        if (method === "PUT") return workspaceUploadResponse(input, init)
        if (url.endsWith("/jobs") && method === "POST") {
          return Response.json(
            { workerJobId: "wj_transient", status: "queued" },
            { status: 202 },
          )
        }
        if (method === "DELETE") {
          return Response.json({ status: "cancelled" }, { status: 202 })
        }
        polls += 1
        if (polls === 1) {
          return Response.json({ error: "temporary" }, { status: 503 })
        }
        return Response.json({
          workerJobId: "wj_transient",
          kind: "devotional-render",
          status: "completed",
          error: null,
          result: {
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
      portrait: { artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE },
      wide: { artifactType: DEVOTIONAL_WIDE_ARTIFACT_TYPE },
    })
    expect(polls).toBe(2)
    expect(methods).not.toContain("DELETE")
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

  it("verifies canonical refs from complete v2 artifact wrappers", async () => {
    const verifyArtifact = vi.fn(async (_ref: unknown) => undefined)
    const store = {
      ...cleanupStore(vi.fn(async () => undefined)),
      verifyArtifact,
    }

    await expect(
      verifyDevotionalWorkerArtifacts(
        {
          portrait: videoArtifact(DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE),
          wide: videoArtifact(DEVOTIONAL_WIDE_ARTIFACT_TYPE),
        },
        { workspaceMediaStore: store },
      ),
    ).resolves.toBeUndefined()
    expect(verifyArtifact).toHaveBeenCalledTimes(2)
    expect(verifyArtifact.mock.calls[0]?.[0]).not.toHaveProperty("assetId")
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

  it.each(["abort", "timeout"] as const)(
    "discards both signed output grants after confirmed %s cancellation",
    async (mode) => {
      const controller = new AbortController()
      const discardUpload = vi.fn(async (_grant: unknown) => undefined)
      const fetchImpl = vi.fn(
        async (input: URL | RequestInfo, init?: RequestInit) => {
          const url = String(input)
          const method = init?.method ?? "GET"
          if (url.endsWith("/jobs") && method === "POST") {
            return Response.json(
              { workerJobId: `wj_${mode}`, status: "queued" },
              { status: 202 },
            )
          }
          if (method === "DELETE") {
            return Response.json(
              { workerJobId: `wj_${mode}`, status: "cancelled" },
              { status: 202 },
            )
          }
          controller.abort()
          return Response.json({
            workerJobId: `wj_${mode}`,
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
            runId: `run-${mode}`,
            devotional: DEVO,
            audio: AUDIO,
            workspaceGeneration: 3,
            attemptId: `attempt_${mode}`,
            selectedSources: WORKSPACE.selectedSources,
            renderConfig: RENDER_CONFIG,
          },
          {
            baseUrl: "https://worker.example.org",
            apiKey: "secret",
            fetchImpl: fetchImpl as unknown as typeof fetch,
            workspaceMediaStore: cleanupStore(discardUpload),
            sleep: async () => undefined,
            ...(mode === "abort"
              ? { abortSignal: controller.signal, pollIntervalMs: 0 }
              : { pollTimeoutMs: -1 }),
          },
        ),
      ).rejects.toMatchObject({
        code: mode === "abort" ? "job_failed" : "job_timeout",
      })
      expect(
        new Set(
          discardUpload.mock.calls.map(([grant]) =>
            String((grant as { key: string }).key),
          ),
        ).size,
      ).toBe(2)
    },
  )

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

  it("serves pre-cutover v2 video from its Mastra-owned manifest", async () => {
    const outputRef = {
      schemaVersion: "2" as const,
      key: `runs/g3/${ATTEMPT_TOKEN}/attempt-output/${"a".repeat(64)}/portrait.mp4`,
      digest: "a".repeat(64),
      size: 100,
      contentType: "video/mp4",
      attempt: ATTEMPT,
    }
    const manifestBody = Buffer.from(
      JSON.stringify({
        schemaVersion: "2",
        kind: "attempt-output",
        attempt: ATTEMPT,
        artifacts: [
          {
            artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
            ext: "mp4",
            ref: outputRef,
          },
        ],
        report: {
          portrait: { outputDurationSec: 60, width: 1080, height: 1920 },
          wide: { outputDurationSec: 60, width: 1920, height: 1080 },
        },
      }),
    )
    const manifestDigest = createHash("sha256")
      .update(manifestBody)
      .digest("hex")
    const fetchArtifact = vi.fn(
      async () => new Response(new Uint8Array([2, 3]), { status: 206 }),
    )
    const unavailable = async (): Promise<never> => {
      throw new Error("not used")
    }
    const workspaceMediaStore: DevotionalWorkspaceMediaStore = {
      supportsSignedTransfers: true,
      writeImmutableArtifact: unavailable,
      createReadGrant: unavailable,
      createUploadGrant: unavailable,
      finalizeUpload: unavailable,
      verifyArtifact: async () => undefined,
      readManifest: async () => manifestBody,
      readAttemptOutput: async () => null,
      discardUpload: async () => undefined,
      fetchArtifact,
    }

    const response = await fetchDevotionalWorkerArtifact(
      {
        assetId: `dv2o_g3_${ATTEMPT_TOKEN}_${manifestDigest}_${manifestBody.byteLength}`,
        artifactType: DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
        ext: "mp4",
      },
      "bytes=1-2",
      { workspaceMediaStore },
    )

    expect(response.status).toBe(206)
    expect(fetchArtifact).toHaveBeenCalledWith(outputRef, "bytes=1-2")
  })
})
