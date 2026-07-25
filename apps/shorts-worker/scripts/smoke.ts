// HOST smoke: proves the REAL prepare + render pipelines end to end with
// real binaries — ffmpeg (lavfi synthetic source), a loopback http source
// server, runtime Remotion bundle(), and real Chromium (auto-downloaded via
// ensureBrowser). Whisper runs only when SHORTS_WORKER_WHISPER_MODEL_PATH is
// set; otherwise the unsupported-language skip path is asserted. Local
// artifacts mode (no S3). The in-container smoke (Docker) supersedes this
// for deploy proof; this one is for fast local iteration.
//
// Usage: pnpm --filter @forge/shorts-worker smoke

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { cpus, tmpdir } from "node:os"
import { join } from "node:path"

async function main(): Promise<void> {
  const startedAt = Date.now()
  const tmpRoot = await mkdtemp(join(tmpdir(), "shorts-worker-smoke-"))
  const artifactsDir = join(tmpRoot, "artifacts")

  // Configure env BEFORE importing src modules (env is parsed at import).
  process.env.NODE_ENV = "development"
  process.env.SHORTS_WORKER_LOCAL_ARTIFACTS_DIR = artifactsDir
  process.env.SHORTS_WORKER_ALLOWED_SOURCE_HOSTS = "127.0.0.1"
  delete process.env.RAILWAY_S3_BUCKET
  delete process.env.SHORTS_WORKER_BUNDLE_DIR
  process.env.SHORTS_WORKER_RENDER_CONCURRENCY ??= String(
    Math.max(2, Math.floor(cpus().length / 2)),
  )

  const { defaultRunCommand } = await import("../src/ffmpeg.js")
  const { startClipServer } = await import("../src/clip-server.js")
  const { runPrepare, CLIP_META_ARTIFACT_TYPE, CAPTIONS_ARTIFACT_TYPE } =
    await import("../src/prepare.js")
  const { runRender } = await import("../src/render.js")
  const { probeMedia } = await import("../src/ffmpeg.js")

  const assetId = "smoke-short-1"
  let sourceServer: Awaited<ReturnType<typeof startClipServer>> | null = null

  try {
    // 1. Synthetic 20s source: testsrc2 1280x720@30 + 440Hz sine audio.
    console.log("[shorts-worker] event=smoke_source_generate_started")
    const sourcePath = join(tmpRoot, "source.mp4")
    await defaultRunCommand(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1280x720:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100",
        "-t",
        "20",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        sourcePath,
      ],
      { timeoutMs: 120_000 },
    )

    // 2. Serve it over loopback http (allowlisted as 127.0.0.1 above).
    sourceServer = await startClipServer(sourcePath)
    console.log(
      `[shorts-worker] event=smoke_source_served url=${sourceServer.url}`,
    )

    // 3. REAL prepare: 10s clip from -ss 5. Whisper runs only when a model
    //    is configured; otherwise language null asserts the skip path.
    const whisperConfigured = Boolean(
      process.env.SHORTS_WORKER_WHISPER_MODEL_PATH,
    )
    const language = whisperConfigured ? "en" : null
    const prepareStartedAt = Date.now()
    const prepareResult = await runPrepare({
      assetId,
      sourceUrl: sourceServer.url,
      clip: { startSec: 5, endSec: 15 },
      language,
      onProgress: (progress, message) => {
        console.log(
          `[shorts-worker] event=smoke_prepare_progress progress=${progress.toFixed(2)} message=${JSON.stringify(message)}`,
        )
      },
    })
    console.log(
      `[shorts-worker] event=smoke_prepare_completed seconds=${((Date.now() - prepareStartedAt) / 1000).toFixed(1)} report=${JSON.stringify(prepareResult.report)}`,
    )

    // Assert clip artifact + meta sanity.
    const clipArtifactPath = join(artifactsDir, assetId, "shorts-clip-v1.mp4")
    await readFile(clipArtifactPath) // throws if missing
    const meta = JSON.parse(
      (
        await readFile(
          join(artifactsDir, assetId, `${CLIP_META_ARTIFACT_TYPE}.json`),
        )
      ).toString("utf8"),
    ) as {
      durationSec: number
      fps: number
      hasAudio: boolean
      sourceHost: string
      clip: { startSec: number; endSec: number }
    }
    assert(
      Math.abs(meta.durationSec - 10) <= 0.5,
      `clip duration ${meta.durationSec} should be ~10s`,
    )
    assert(Math.abs(meta.fps - 30) <= 0.5, `clip fps ${meta.fps} should be ~30`)
    assert(meta.hasAudio, "clip should carry the sine audio stream")
    assert(
      meta.sourceHost === "127.0.0.1",
      `meta.sourceHost should be host-only, got ${meta.sourceHost}`,
    )
    assert(
      meta.clip.startSec === 5 && meta.clip.endSec === 15,
      `meta.clip should record the clamped bounds, got ${JSON.stringify(meta.clip)}`,
    )
    if (whisperConfigured) {
      assert(
        prepareResult.report.annotation === null,
        "whisper run should not be annotated",
      )
    } else {
      assert(
        prepareResult.report.annotation ===
          "transcription_unsupported_language",
        `expected the unsupported-language skip annotation, got ${String(prepareResult.report.annotation)}`,
      )
    }
    const captionsArtifact = JSON.parse(
      (
        await readFile(
          join(artifactsDir, assetId, `${CAPTIONS_ARTIFACT_TYPE}.json`),
        )
      ).toString("utf8"),
    ) as { captions: unknown[] }
    console.log(
      `[shorts-worker] event=smoke_prepare_asserted captions=${captionsArtifact.captions.length}`,
    )

    // 4. Real Chromium: ensure it's downloaded before the render starts so
    //    the render timing is honest.
    console.log("[shorts-worker] event=smoke_browser_ensure_started")
    const browserEnsureStartedAt = Date.now()
    const { ensureBrowser } = await import("@remotion/renderer")
    await ensureBrowser()
    console.log(
      `[shorts-worker] event=smoke_browser_ensured seconds=${((Date.now() - browserEnsureStartedAt) / 1000).toFixed(1)}`,
    )

    // 5. REAL render: runtime bundle() + real Chromium + ffprobe assertions.
    //    Minimal props fixture: 2 caption pages, bars waveform, focus
    //    template.
    const renderStartedAt = Date.now()
    const renderResult = await runRender({
      assetId,
      propsHash: "a".repeat(64),
      draftVersion: 1,
      props: {
        templateId: "focus",
        accentColor: "#FFC83D",
        captionPosition: "center",
        captionFont: "montserrat",
        waveformStyle: "bars",
        title: "Smoke test",
        showCaptions: true,
        captionPages: [
          {
            text: "Hello world",
            startMs: 500,
            durationMs: 1500,
            tokens: [
              { text: "Hello", fromMs: 500, toMs: 1200 },
              { text: " world", fromMs: 1200, toMs: 2000 },
            ],
          },
          {
            text: "Second page",
            startMs: 2500,
            durationMs: 1500,
            tokens: [
              { text: "Second", fromMs: 2500, toMs: 3200 },
              { text: " page", fromMs: 3200, toMs: 4000 },
            ],
          },
        ],
        fps: 30,
        clipDurationSec: meta.durationSec,
        hasAudio: meta.hasAudio,
      },
      onProgress: (progress, message) => {
        console.log(
          `[shorts-worker] event=smoke_render_progress progress=${progress.toFixed(2)} message=${JSON.stringify(message)}`,
        )
      },
    })
    console.log(
      `[shorts-worker] event=smoke_render_completed seconds=${((Date.now() - renderStartedAt) / 1000).toFixed(1)} report=${JSON.stringify(renderResult.report)}`,
    )

    // 6. ffprobe the output artifact independently of the pipeline's own
    //    sanity check.
    const outputPath = join(artifactsDir, assetId, "shorts-output-v1.mp4")
    const output = await probeMedia(outputPath)
    assert(
      output.width === 1080 && output.height === 1920,
      `output should be 1080x1920, got ${output.width}x${output.height}`,
    )
    assert(
      Math.abs(output.durationSec - 10) <= 0.5,
      `output duration ${output.durationSec} should be 10s ±0.5`,
    )

    console.log(
      `[shorts-worker] event=smoke_passed totalSeconds=${((Date.now() - startedAt) / 1000).toFixed(1)} whisper=${whisperConfigured ? "ran" : "skipped"}`,
    )
  } finally {
    if (sourceServer) await sourceServer.close().catch(() => {})
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`smoke assertion failed: ${message}`)
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(
    `[shorts-worker] event=smoke_failed error=${JSON.stringify(message)}`,
  )
  process.exit(1)
})
