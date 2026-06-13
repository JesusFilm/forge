import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { COMPOSITIONS_VERSION } from "@forge/shorts-compositions/version"
import type { RunCommand } from "./ffmpeg.js"
import { CLIP_ARTIFACT_TYPE } from "./prepare.js"
import {
  _resetRuntimeBundleCacheForTests,
  OUTPUT_ARTIFACT_TYPE,
  OutputSanityError,
  RENDER_META_ARTIFACT_TYPE,
  runRender,
  type EngineBrowser,
  type RenderEngine,
  type RenderProps,
} from "./render.js"
import { createStorage, type Storage } from "./storage.js"
import { ArtifactNotFoundError } from "./storage.js"
import type { RenderMetaArtifact } from "./types.js"

const PROPS: RenderProps = {
  templateId: "focus",
  accentColor: "#FFC83D",
  captionPosition: "center",
  captionFont: "montserrat",
  waveformStyle: "bars",
  title: "Test short",
  showCaptions: true,
  captionPages: [
    {
      text: "Hello world",
      startMs: 0,
      durationMs: 1200,
      tokens: [
        { text: "Hello", fromMs: 0, toMs: 600 },
        { text: " world", fromMs: 600, toMs: 1200 },
      ],
    },
  ],
  fps: 30,
  clipDurationSec: 10,
  hasAudio: true,
}

const PROPS_HASH = "a".repeat(64)

type EngineCalls = {
  bundle: Array<{ entryPoint: string }>
  selectComposition: Array<Record<string, unknown>>
  renderMedia: Array<Record<string, unknown>>
  browsersOpened: number
  browsersClosed: number
}

function createFakeEngine(options?: { failRenderMedia?: boolean }): {
  engine: RenderEngine
  calls: EngineCalls
} {
  const calls: EngineCalls = {
    bundle: [],
    selectComposition: [],
    renderMedia: [],
    browsersOpened: 0,
    browsersClosed: 0,
  }

  const engine: RenderEngine = {
    async bundle({ entryPoint }) {
      calls.bundle.push({ entryPoint })
      return "/tmp/fake-bundle"
    },
    async openBrowser() {
      calls.browsersOpened += 1
      const browser: EngineBrowser = {
        async close() {
          calls.browsersClosed += 1
          return undefined
        },
      }
      return browser
    },
    async selectComposition(options) {
      calls.selectComposition.push(options as Record<string, unknown>)
      return {
        id: options.id,
        width: 1080,
        height: 1920,
        fps: 30,
        durationInFrames: 300,
      }
    },
    async renderMedia(renderOptions) {
      calls.renderMedia.push(renderOptions as Record<string, unknown>)
      if (options?.failRenderMedia) {
        throw new Error("renderMedia exploded")
      }
      renderOptions.onProgress({ progress: 0.5 })
      renderOptions.onProgress({ progress: 1 })
      await writeFile(renderOptions.outputLocation, Buffer.from("fake-output"))
      return undefined
    },
  }

  return { engine, calls }
}

function createSanityRunCommand(probe: {
  width: number
  height: number
  durationSec: number
}): RunCommand {
  return async (command) => {
    if (command !== "ffprobe") {
      throw new Error(`unexpected command ${command}`)
    }
    return {
      stdout: Buffer.from(
        JSON.stringify({
          streams: [
            {
              codec_type: "video",
              width: probe.width,
              height: probe.height,
              avg_frame_rate: "30/1",
            },
            { codec_type: "audio" },
          ],
          format: { duration: String(probe.durationSec) },
        }),
      ),
      stderr: "",
    }
  }
}

describe("runRender", () => {
  let root: string
  let storage: Storage

  beforeEach(async () => {
    _resetRuntimeBundleCacheForTests()
    root = await mkdtemp(join(tmpdir(), "shorts-worker-render-test-"))
    storage = createStorage({ localRootDir: root })
    await storage.writeArtifact({
      assetId: "asset1",
      artifactType: CLIP_ARTIFACT_TYPE,
      ext: "mp4",
      body: Buffer.from("fake-clip"),
      contentType: "video/mp4",
    })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("renders via the engine: loopback clipUrl injected, per-job browser closed, artifacts written", async () => {
    const { engine, calls } = createFakeEngine()
    const progress: Array<[number, string]> = []

    const result = await runRender({
      assetId: "asset1",
      propsHash: PROPS_HASH,
      draftVersion: 3,
      props: PROPS,
      deps: {
        storage,
        engine,
        runCommand: createSanityRunCommand({
          width: 1080,
          height: 1920,
          durationSec: 10.1,
        }),
        bundleDir: "/app/bundle",
        concurrency: 2,
        now: () => new Date("2026-06-11T00:00:00.000Z"),
      },
      onProgress: (value, message) => progress.push([value, message]),
    })

    // Baked bundle path: runtime bundling never invoked.
    expect(calls.bundle).toHaveLength(0)

    // selectComposition + renderMedia share the SAME per-job browser.
    expect(calls.browsersOpened).toBe(1)
    expect(calls.browsersClosed).toBe(1)
    expect(calls.selectComposition[0]!.puppeteerInstance).toBe(
      calls.renderMedia[0]!.puppeteerInstance,
    )
    expect(calls.selectComposition[0]!.id).toBe("short")
    expect(calls.selectComposition[0]!.serveUrl).toBe("/app/bundle")

    // The worker injects the loopback clipUrl; everything else passes through.
    const inputProps = calls.renderMedia[0]!.inputProps as Record<
      string,
      unknown
    >
    expect(inputProps.clipUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/clip\.mp4$/)
    expect(inputProps.templateId).toBe("focus")
    expect(calls.renderMedia[0]!.codec).toBe("h264")
    expect(calls.renderMedia[0]!.concurrency).toBe(2)
    expect(calls.renderMedia[0]!.offthreadVideoCacheSizeInBytes).toBe(
      1024 * 1024 * 1024,
    )
    expect(calls.renderMedia[0]!.timeoutInMilliseconds).toBe(120_000)

    expect(result.artifacts).toEqual([
      { assetId: "asset1", artifactType: OUTPUT_ARTIFACT_TYPE, ext: "mp4" },
      {
        assetId: "asset1",
        artifactType: RENDER_META_ARTIFACT_TYPE,
        ext: "json",
      },
    ])
    expect(result.report).toEqual({
      outputDurationSec: 10.1,
      width: 1080,
      height: 1920,
    })

    await expect(
      storage.artifactExists("asset1", OUTPUT_ARTIFACT_TYPE, "mp4"),
    ).resolves.toBe(true)

    const meta = JSON.parse(
      (
        await readFile(
          join(root, "asset1", `${RENDER_META_ARTIFACT_TYPE}.json`),
        )
      ).toString("utf8"),
    ) as RenderMetaArtifact
    expect(meta).toEqual({
      propsHash: PROPS_HASH, // opaque passthrough — never recomputed
      renderedDraftVersion: 3,
      compositionsVersion: COMPOSITIONS_VERSION,
      generatedAt: "2026-06-11T00:00:00.000Z",
    })

    expect(progress.length).toBeGreaterThan(2)
  })

  it("closes the per-job browser even when renderMedia throws", async () => {
    const { engine, calls } = createFakeEngine({ failRenderMedia: true })

    await expect(
      runRender({
        assetId: "asset1",
        propsHash: PROPS_HASH,
        draftVersion: 1,
        props: PROPS,
        deps: {
          storage,
          engine,
          runCommand: createSanityRunCommand({
            width: 1080,
            height: 1920,
            durationSec: 10,
          }),
          bundleDir: "/app/bundle",
        },
      }),
    ).rejects.toThrow("renderMedia exploded")

    expect(calls.browsersOpened).toBe(1)
    expect(calls.browsersClosed).toBe(1)
  })

  it("fails with typed OutputSanityError on wrong dimensions and writes NO output artifact", async () => {
    const { engine } = createFakeEngine()

    await expect(
      runRender({
        assetId: "asset1",
        propsHash: PROPS_HASH,
        draftVersion: 1,
        props: PROPS,
        deps: {
          storage,
          engine,
          runCommand: createSanityRunCommand({
            width: 720,
            height: 1280,
            durationSec: 10,
          }),
          bundleDir: "/app/bundle",
        },
      }),
    ).rejects.toBeInstanceOf(OutputSanityError)

    await expect(
      storage.artifactExists("asset1", OUTPUT_ARTIFACT_TYPE, "mp4"),
    ).resolves.toBe(false)
  })

  it("fails sanity when the output duration drifts past ±0.5s", async () => {
    const { engine } = createFakeEngine()

    await expect(
      runRender({
        assetId: "asset1",
        propsHash: PROPS_HASH,
        draftVersion: 1,
        props: PROPS,
        deps: {
          storage,
          engine,
          runCommand: createSanityRunCommand({
            width: 1080,
            height: 1920,
            durationSec: 11.2,
          }),
          bundleDir: "/app/bundle",
        },
      }),
    ).rejects.toThrow(/duration/)
  })

  it("throws typed ArtifactNotFoundError when the clip artifact is missing", async () => {
    const { engine, calls } = createFakeEngine()

    await expect(
      runRender({
        assetId: "asset-without-prepare",
        propsHash: PROPS_HASH,
        draftVersion: 1,
        props: PROPS,
        deps: { storage, engine, bundleDir: "/app/bundle" },
      }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError)

    expect(calls.browsersOpened).toBe(0)
  })

  it("memoizes the runtime bundle when no baked bundle dir is set", async () => {
    const { engine, calls } = createFakeEngine()
    const deps = {
      storage,
      engine,
      runCommand: createSanityRunCommand({
        width: 1080,
        height: 1920,
        durationSec: 10,
      }),
      bundleDir: undefined,
    }

    await runRender({
      assetId: "asset1",
      propsHash: PROPS_HASH,
      draftVersion: 1,
      props: PROPS,
      deps,
    })
    await runRender({
      assetId: "asset1",
      propsHash: "b".repeat(64),
      draftVersion: 2,
      props: PROPS,
      deps,
    })

    expect(calls.bundle).toHaveLength(1)
    expect(calls.bundle[0]!.entryPoint).toMatch(/shorts-compositions/)
    expect(calls.selectComposition[0]!.serveUrl).toBe("/tmp/fake-bundle")
  })
})
