import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createJobDeadline, JobDeadlineExceededError } from "./deadline.js"
import {
  DEVOTIONAL_INPUT_ARTIFACT_TYPE,
  DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
  DEVOTIONAL_RENDER_META_ARTIFACT_TYPE,
  DEVOTIONAL_WIDE_ARTIFACT_TYPE,
  DevotionalRenderCancelledError,
  devotionalNarrationArtifactType,
  runDevotionalRender,
} from "./devotional-render.js"
import type { RunCommand } from "./ffmpeg.js"
import type { RenderEngine } from "./render.js"
import {
  createStorage,
  devotionalAttemptToken,
  devotionalManifestKey,
  devotionalWorkspaceAssetId,
  devotionalWorkspaceKey,
  type Storage,
} from "./storage.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

const inputSpec = {
  schemaVersion: "1",
  renderConfig: JSON.parse(
    readFileSync(
      new URL(
        "../../mastra/devotional-workspace/inputs/render/styles.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
  headerDate: "Monday · July 21",
  media: {
    mediaId: "1_jf-0-0",
    clipStartSec: 10,
    clipLengthSec: 15,
  },
  cards: [
    { kind: "cover", title: "Come and see", narrationId: "cover" },
    { kind: "video" },
    { kind: "questions", questions: ["What now?"], narrationId: "questions" },
  ],
  music: false,
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "devotional-render-test-"))
  roots.push(root)
  const storage = createStorage({ localRootDir: root })
  await storage.writeArtifact({
    assetId: "input-1",
    artifactType: DEVOTIONAL_INPUT_ARTIFACT_TYPE,
    ext: "json",
    body: JSON.stringify(inputSpec),
  })
  for (const id of ["cover", "questions"]) {
    await storage.writeArtifact({
      assetId: "input-1",
      artifactType: devotionalNarrationArtifactType(id),
      ext: "mp3",
      body: Buffer.from(`audio-${id}`),
    })
  }
  return { storage }
}

async function setupV2() {
  const { storage } = await setup()
  const attempt = {
    workspaceGeneration: 2,
    attemptId: "attempt_2",
    runId: "run_2",
  }
  const artifacts = []
  for (const [artifactType, ext, body, contentType] of [
    [
      DEVOTIONAL_INPUT_ARTIFACT_TYPE,
      "json",
      Buffer.from(JSON.stringify(inputSpec)),
      "application/json",
    ],
    [
      devotionalNarrationArtifactType("cover"),
      "mp3",
      Buffer.from("audio-cover"),
      "audio/mpeg",
    ],
    [
      devotionalNarrationArtifactType("questions"),
      "mp3",
      Buffer.from("audio-questions"),
      "audio/mpeg",
    ],
  ] as const) {
    const digest = createHash("sha256").update(body).digest("hex")
    const ref = await storage.writeWorkspaceArtifact({
      key: devotionalWorkspaceKey(
        attempt,
        "run-input",
        digest,
        `${artifactType}.${ext}`,
      ),
      body,
      digest,
      size: body.byteLength,
      contentType,
      attempt,
    })
    artifacts.push({ artifactType, ext, ref })
  }
  const manifestBody = Buffer.from(
    JSON.stringify({
      schemaVersion: "2",
      kind: "run-input",
      attempt,
      artifacts,
    }),
  )
  const digest = createHash("sha256").update(manifestBody).digest("hex")
  const manifestRef = await storage.writeWorkspaceArtifact({
    key: devotionalManifestKey(attempt, "run-input"),
    body: manifestBody,
    digest,
    size: manifestBody.byteLength,
    contentType: "application/json",
    attempt,
  })
  return {
    storage,
    attempt,
    inputAssetId: devotionalWorkspaceAssetId({
      kind: "input",
      workspaceGeneration: attempt.workspaceGeneration,
      attemptToken: devotionalAttemptToken(attempt.attemptId),
      manifestDigest: manifestRef.digest,
      manifestSize: manifestRef.size,
    }),
  }
}

function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith("https://api.arclight.org/")) {
      return new Response(
        JSON.stringify({
          downloadUrls: { high: { url: "https://cdn.example.org/source.mp4" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    return new Response(Buffer.from("source-video"), {
      status: 200,
      headers: { "content-length": "12" },
    })
  }) as typeof fetch
}

function fakeRunCommand(): RunCommand {
  return async (command, args) => {
    if (command === "ffmpeg") {
      await writeFile(args.at(-1)!, "media")
      return { stdout: Buffer.alloc(0), stderr: "" }
    }
    if (args.includes("default=nw=1:nk=1")) {
      return { stdout: Buffer.from("5\n"), stderr: "" }
    }
    const file = args.at(-1)!
    const media = file.endsWith("portrait.mp4")
      ? { width: 1080, height: 1920, duration: "2" }
      : file.endsWith("wide.mp4")
        ? { width: 1920, height: 1080, duration: "2" }
        : file.endsWith("clip.mp4")
          ? { width: 640, height: 360, duration: "14" }
          : { width: 640, height: 360, duration: "120" }
    return {
      stdout: Buffer.from(
        JSON.stringify({
          streams: [
            {
              codec_type: "video",
              width: media.width,
              height: media.height,
              duration: media.duration,
              avg_frame_rate: "30/1",
            },
            { codec_type: "audio" },
          ],
          format: { duration: media.duration },
        }),
      ),
      stderr: "",
    }
  }
}

function fakeEngine(
  options: {
    failWide?: boolean
    hang?: boolean
    onRender?: () => void
  } = {},
) {
  const calls = { bundle: 0, renders: [] as string[], closes: 0 }
  const engine: RenderEngine = {
    async bundle({ outDir }) {
      calls.bundle += 1
      return outDir!
    },
    async openBrowser() {
      return {
        async close() {
          calls.closes += 1
        },
      }
    },
    async selectComposition({ id }) {
      return {
        id,
        width: id === "devotional-wide" ? 1920 : 1080,
        height: id === "devotional-wide" ? 1080 : 1920,
        fps: 30,
        durationInFrames: 60,
      }
    },
    async renderMedia({ composition, outputLocation }) {
      calls.renders.push(composition.id)
      options.onRender?.()
      if (options.hang) return new Promise(() => {})
      if (options.failWide && composition.id === "devotional-wide") {
        throw new Error("wide renderer failed")
      }
      await writeFile(outputLocation, "rendered")
    },
  }
  return { engine, calls }
}

describe("runDevotionalRender", () => {
  it("prepares media, bundles once, and persists both aspect outputs", async () => {
    const { storage } = await setup()
    const { engine, calls } = fakeEngine()
    const result = await runDevotionalRender({
      runId: "run-1",
      inputAssetId: "input-1",
      outputAssetId: "output-1",
      inputHash: "a".repeat(64),
      deps: {
        storage,
        engine,
        runCommand: fakeRunCommand(),
        fetchImpl: fakeFetch(),
        allowedHosts: ["cdn.example.org"],
        nodeEnv: "production",
        bundleDir: undefined,
      },
    })
    expect(calls.bundle).toBe(1)
    expect(calls.renders).toEqual(["devotional", "devotional-wide"])
    expect(calls.closes).toBe(1)
    expect(result.report.portrait).toMatchObject({ width: 1080, height: 1920 })
    expect(result.report.wide).toMatchObject({ width: 1920, height: 1080 })
    for (const artifactType of [
      DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
      DEVOTIONAL_WIDE_ARTIFACT_TYPE,
      DEVOTIONAL_RENDER_META_ARTIFACT_TYPE,
    ]) {
      await expect(
        storage.artifactExists(
          "output-1",
          artifactType,
          artifactType === DEVOTIONAL_RENDER_META_ARTIFACT_TYPE
            ? "json"
            : "mp4",
        ),
      ).resolves.toBe(true)
    }
  })

  it("does not persist a portrait when the wide render fails", async () => {
    const { storage } = await setup()
    const { engine, calls } = fakeEngine({ failWide: true })
    await expect(
      runDevotionalRender({
        runId: "run-1",
        inputAssetId: "input-1",
        outputAssetId: "output-1",
        inputHash: "a".repeat(64),
        deps: {
          storage,
          engine,
          runCommand: fakeRunCommand(),
          fetchImpl: fakeFetch(),
          allowedHosts: ["cdn.example.org"],
          nodeEnv: "production",
          bundleDir: undefined,
        },
      }),
    ).rejects.toThrow("wide renderer failed")
    expect(calls.closes).toBe(1)
    await expect(
      storage.artifactExists(
        "output-1",
        DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
        "mp4",
      ),
    ).resolves.toBe(false)
  })

  it("keeps an immutable portrait blob when output upload crashes before the manifest", async () => {
    const { storage, attempt, inputAssetId } = await setupV2()
    const { engine } = fakeEngine()
    let writes = 0
    const failingStorage: Storage = {
      ...storage,
      async writeWorkspaceArtifactFromFile(options) {
        writes += 1
        if (writes === 2) throw new Error("wide upload failed")
        return storage.writeWorkspaceArtifactFromFile(options)
      },
    }
    await expect(
      runDevotionalRender({
        runId: "run_2",
        inputAssetId,
        outputAssetId: `dv2o_g2_${devotionalAttemptToken(attempt.attemptId)}`,
        inputHash: "a".repeat(64),
        deps: {
          storage: failingStorage,
          engine,
          runCommand: fakeRunCommand(),
          fetchImpl: fakeFetch(),
          allowedHosts: ["cdn.example.org"],
          nodeEnv: "production",
          bundleDir: undefined,
        },
      }),
    ).rejects.toThrow("wide upload failed")

    const outputDigest = createHash("sha256").update("rendered").digest("hex")
    await expect(
      storage.workspaceArtifactExists(
        devotionalWorkspaceKey(
          attempt,
          "attempt-output",
          outputDigest,
          "portrait.mp4",
        ),
      ),
    ).resolves.toBe(true)
    await expect(
      storage.workspaceArtifactExists(
        devotionalManifestKey(attempt, "attempt-output"),
      ),
    ).resolves.toBe(false)
  })

  it("replays a completed attempt from its immutable output manifest", async () => {
    const { storage, attempt, inputAssetId } = await setupV2()
    const outputAssetId = `dv2o_g2_${devotionalAttemptToken(attempt.attemptId)}`
    const firstEngine = fakeEngine()
    const first = await runDevotionalRender({
      runId: "run_2",
      inputAssetId,
      outputAssetId,
      inputHash: "a".repeat(64),
      deps: {
        storage,
        engine: firstEngine.engine,
        runCommand: fakeRunCommand(),
        fetchImpl: fakeFetch(),
        allowedHosts: ["cdn.example.org"],
        nodeEnv: "production",
        bundleDir: undefined,
      },
    })

    const replayEngine = fakeEngine({ failWide: true })
    const replay = await runDevotionalRender({
      runId: "run_2",
      inputAssetId,
      outputAssetId,
      inputHash: "a".repeat(64),
      deps: { storage, engine: replayEngine.engine },
    })

    expect(replayEngine.calls.renders).toEqual([])
    expect(replay.artifacts).toEqual(first.artifacts)
  })

  it("closes Chromium and leaves no output when the job deadline expires", async () => {
    const { storage } = await setup()
    let now = 0
    const { engine, calls } = fakeEngine({
      hang: true,
      onRender: () => {
        now = 999
      },
    })
    await expect(
      runDevotionalRender({
        runId: "run-1",
        inputAssetId: "input-1",
        outputAssetId: "output-1",
        inputHash: "a".repeat(64),
        deps: {
          storage,
          engine,
          runCommand: fakeRunCommand(),
          fetchImpl: fakeFetch(),
          allowedHosts: ["cdn.example.org"],
          nodeEnv: "production",
          bundleDir: undefined,
          deadline: createJobDeadline(1_000, () => now),
        },
      }),
    ).rejects.toBeInstanceOf(JobDeadlineExceededError)
    expect(calls.closes).toBe(1)
    await expect(
      storage.artifactExists(
        "output-1",
        DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
        "mp4",
      ),
    ).resolves.toBe(false)
  })

  it("closes Chromium and cleans up when cancellation interrupts rendering", async () => {
    const { storage } = await setup()
    const { engine, calls } = fakeEngine({ hang: true })
    const controller = new AbortController()
    const render = runDevotionalRender({
      runId: "run-1",
      inputAssetId: "input-1",
      outputAssetId: "output-1",
      inputHash: "a".repeat(64),
      deps: {
        storage,
        engine,
        runCommand: fakeRunCommand(),
        fetchImpl: fakeFetch(),
        allowedHosts: ["cdn.example.org"],
        nodeEnv: "production",
        bundleDir: undefined,
        signal: controller.signal,
      },
    })
    while (calls.renders.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    controller.abort()
    await expect(render).rejects.toBeInstanceOf(DevotionalRenderCancelledError)
    expect(calls.closes).toBe(1)
    await expect(
      storage.artifactExists(
        "output-1",
        DEVOTIONAL_PORTRAIT_ARTIFACT_TYPE,
        "mp4",
      ),
    ).resolves.toBe(false)
  })

  it("closes Chromium when startup resolves after cancellation", async () => {
    const { storage } = await setup()
    const { engine, calls } = fakeEngine()
    const controller = new AbortController()
    let signalOpenStarted!: () => void
    const openStarted = new Promise<void>((resolve) => {
      signalOpenStarted = resolve
    })
    let resolveBrowser!: (
      browser: Awaited<ReturnType<RenderEngine["openBrowser"]>>,
    ) => void
    const openingBrowser = new Promise<
      Awaited<ReturnType<RenderEngine["openBrowser"]>>
    >((resolve) => {
      resolveBrowser = resolve
    })
    engine.openBrowser = async () => {
      signalOpenStarted()
      return openingBrowser
    }

    const render = runDevotionalRender({
      runId: "run-1",
      inputAssetId: "input-1",
      outputAssetId: "output-1",
      inputHash: "a".repeat(64),
      deps: {
        storage,
        engine,
        runCommand: fakeRunCommand(),
        fetchImpl: fakeFetch(),
        allowedHosts: ["cdn.example.org"],
        nodeEnv: "production",
        bundleDir: undefined,
        signal: controller.signal,
      },
    })
    await openStarted
    controller.abort()
    await expect(render).rejects.toBeInstanceOf(DevotionalRenderCancelledError)

    resolveBrowser({
      async close() {
        calls.closes += 1
      },
    })
    await openingBrowser
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.closes).toBe(1)
  })
})
