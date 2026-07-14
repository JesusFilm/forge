import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createJobDeadline, JobDeadlineExceededError } from "./deadline.js"
import type { RunCommand } from "./ffmpeg.js"
import {
  buildCropFilter,
  buildXExpression,
  CROP_PLAN_ARTIFACT_TYPE,
  runRender,
  TIMELINE_MAP_ARTIFACT_TYPE,
} from "./render.js"
import { createStorage, type Storage } from "./storage.js"
import type { RenderSegment } from "./types.js"

describe("buildXExpression", () => {
  it("returns a static x when both keyframes share the same x", () => {
    expect(
      buildXExpression(
        [
          { progress: 0, x: 520, y: 0, width: 606, height: 1080 },
          { progress: 1, x: 520, y: 0, width: 606, height: 1080 },
        ],
        6,
      ),
    ).toBe("520")
  })

  it("returns a clamped lerp for two distinct keyframes", () => {
    expect(
      buildXExpression(
        [
          { progress: 0, x: 520, y: 0, width: 606, height: 1080 },
          { progress: 1, x: 560, y: 0, width: 606, height: 1080 },
        ],
        6,
      ),
    ).toBe("520+40*min(t/6,1)")
  })

  it("supports a negative pan delta", () => {
    expect(
      buildXExpression(
        [
          { progress: 0, x: 560, y: 0, width: 606, height: 1080 },
          { progress: 1, x: 520, y: 0, width: 606, height: 1080 },
        ],
        6,
      ),
    ).toBe("560+-40*min(t/6,1)")
  })

  it("rounds x values to even integers", () => {
    expect(
      buildXExpression(
        [
          { progress: 0, x: 521, y: 0, width: 606, height: 1080 },
          { progress: 1, x: 521, y: 0, width: 606, height: 1080 },
        ],
        6,
      ),
    ).toBe("522")
  })

  it("handles a single keyframe", () => {
    expect(
      buildXExpression(
        [{ progress: 0, x: 100, y: 0, width: 606, height: 1080 }],
        6,
      ),
    ).toBe("100")
  })

  it("builds nested piecewise lerp for more than two keyframes", () => {
    expect(
      buildXExpression(
        [
          { progress: 0, x: 0, y: 0, width: 606, height: 1080 },
          { progress: 0.5, x: 100, y: 0, width: 606, height: 1080 },
          { progress: 1, x: 100, y: 0, width: 606, height: 1080 },
        ],
        6,
      ),
    ).toBe("if(lt(t,3),0+100*min(max((t-0)/3,0),1),if(lt(t,6),100,100))")
  })

  it("honors progress values when two keyframes are not at 0 and 1 (piecewise, not full-span lerp)", () => {
    // progress 0.2/0.8 over 10s: the pan runs from t=2 to t=8, holding the
    // endpoint values outside that window — NOT a t/10 full-span lerp.
    expect(
      buildXExpression(
        [
          { progress: 0.2, x: 520, y: 0, width: 606, height: 1080 },
          { progress: 0.8, x: 560, y: 0, width: 606, height: 1080 },
        ],
        10,
      ),
    ).toBe("if(lt(t,8),520+40*min(max((t-2)/6,0),1),560)")
  })

  it("still returns a static x for two equal-x keyframes regardless of progress", () => {
    expect(
      buildXExpression(
        [
          { progress: 0.2, x: 520, y: 0, width: 606, height: 1080 },
          { progress: 0.8, x: 520, y: 0, width: 606, height: 1080 },
        ],
        10,
      ),
    ).toBe("520")
  })
})

describe("buildCropFilter", () => {
  const baseSegment: RenderSegment = {
    shotId: "shot_00001",
    start: 0,
    end: 6,
    durationSeconds: 6,
    keyframes: [
      { progress: 0, x: 520, y: 0, width: 606, height: 1080 },
      { progress: 1, x: 560, y: 0, width: 606, height: 1080 },
    ],
  }

  it("quotes the animated x expression so min(...)'s comma survives the filter parser", () => {
    expect(buildCropFilter(baseSegment)).toBe(
      "crop=606:1080:'520+40*min(t/6,1)':0,scale=1080:1920:flags=lanczos,setsar=1,setpts=PTS-STARTPTS",
    )
  })

  it("quotes static x expressions too", () => {
    expect(
      buildCropFilter({
        ...baseSegment,
        keyframes: [
          { progress: 0, x: 100, y: 0, width: 606, height: 1080 },
          { progress: 1, x: 100, y: 0, width: 606, height: 1080 },
        ],
      }),
    ).toBe(
      "crop=606:1080:'100':0,scale=1080:1920:flags=lanczos,setsar=1,setpts=PTS-STARTPTS",
    )
  })

  it("throws for a segment without keyframes", () => {
    expect(() => buildCropFilter({ ...baseSegment, keyframes: [] })).toThrow(
      /no crop keyframes/,
    )
  })
})

describe("runRender", () => {
  const sourceUrl = "https://stream.example.test/pb.m3u8"
  const whitelist = "https,tls,tcp,crypto,hls"
  let root: string
  let storage: Storage
  let ffmpegCalls: string[][]
  let runCommand: RunCommand

  const plan = {
    version: 1,
    kind: "smart-crop-canonical-plan",
    assetId: "asset123",
    muxAssetId: "mux_abc",
    playbackId: "pb_abc",
    source: { width: 1920, height: 1080, durationSeconds: 25 },
    target: { aspectRatio: "9:16", width: 1080, height: 1920 },
    strategy: { cropMode: "auto", plannerVersion: "smart-crop-planner-v1" },
    segments: [
      {
        shotId: "shot_00001",
        canonicalStart: 0,
        canonicalEnd: 10,
        mode: "speaker",
        confidence: 0.94,
        cropKeyframes: [
          { progress: 0, x: 520, y: 0, width: 606, height: 1080 },
          { progress: 1, x: 560, y: 0, width: 606, height: 1080 },
        ],
      },
      {
        shotId: "shot_00002",
        canonicalStart: 10,
        canonicalEnd: 25,
        mode: "group",
        confidence: 0.9,
        cropKeyframes: [
          { progress: 0, x: 100, y: 0, width: 606, height: 1080 },
          { progress: 1, x: 100, y: 0, width: 606, height: 1080 },
        ],
      },
    ],
    usage: { inputTokens: 0, outputTokens: 0 },
    qa: { status: "approved" },
    generatedAt: "2026-06-09T00:00:00.000Z",
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "crop-worker-render-test-"))
    storage = createStorage({ localRootDir: root })
    ffmpegCalls = []
    runCommand = async (command, args) => {
      expect(command).toBe("ffmpeg")
      ffmpegCalls.push(args)
      const outPath = args[args.length - 1]!
      await writeFile(outPath, Buffer.from(`fake:${basename(outPath)}`))
      return { stdout: Buffer.alloc(0), stderr: "" }
    }

    await storage.writeArtifact({
      assetId: "asset123",
      artifactType: CROP_PLAN_ARTIFACT_TYPE,
      ext: "json",
      body: JSON.stringify(plan),
      contentType: "application/json",
    })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("renders a canonical preview: segments, concat, upload, frames, report", async () => {
    const progress: Array<[number, string]> = []

    const result = await runRender({
      assetId: "asset123",
      sourceUrl,
      mode: "preview",
      cropPlanAssetId: "asset123",
      previewFrameCount: 2,
      deps: {
        runCommand,
        storage,
        protocolWhitelist: whitelist,
        previewMaxSegments: 6,
        previewMaxSeconds: 90,
        now: () => new Date("2026-06-09T00:00:00.000Z"),
      },
      onProgress: (value, message) => progress.push([value, message]),
    })

    // Segment 1: animated pan, source protocol whitelist, input-seek args in
    // the documented order.
    const firstSegmentArgs = ffmpegCalls[0]!
    expect(firstSegmentArgs.slice(0, 11)).toEqual([
      "-y",
      "-protocol_whitelist",
      whitelist,
      "-ss",
      "0",
      "-t",
      "10",
      "-i",
      sourceUrl,
      "-vf",
      "crop=606:1080:'520+40*min(t/10,1)':0,scale=1080:1920:flags=lanczos,setsar=1,setpts=PTS-STARTPTS",
    ])
    expect(firstSegmentArgs.slice(11, -1)).toEqual([
      "-af",
      "asetpts=PTS-STARTPTS",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
    ])

    // Concat call shape — reads a worker-generated local list file, so the
    // restrictive source whitelist must NOT be applied here.
    const concatArgs = ffmpegCalls[2]!
    expect(concatArgs.slice(0, 6)).toEqual([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
    ])
    expect(concatArgs.slice(7, 9)).toEqual(["-c", "copy"])
    expect(concatArgs).not.toContain("-protocol_whitelist")

    // Frame extraction calls: output duration 25, two frames at 6.25/18.75.
    // These read the local output file — no source whitelist either.
    const frameCalls = ffmpegCalls.filter((args) => args.includes("-frames:v"))
    expect(frameCalls.map((args) => args[2])).toEqual(["6.25", "18.75"])
    expect(frameCalls[0]!.slice(0, 2)).toEqual(["-y", "-ss"])
    expect(frameCalls[0]).toContain("-q:v")
    expect(frameCalls[0]).not.toContain("-protocol_whitelist")

    // Uploaded artifacts.
    await expect(
      storage.artifactExists("asset123", "smart-crop-preview-9x16", "mp4"),
    ).resolves.toBe(true)
    await expect(
      storage.artifactExists(
        "asset123",
        "smart-crop-preview-frame-9x16-001",
        "jpg",
      ),
    ).resolves.toBe(true)
    await expect(
      storage.artifactExists(
        "asset123",
        "smart-crop-render-report-9x16-preview",
        "json",
      ),
    ).resolves.toBe(true)

    // Report per contract.
    expect(result.report).toMatchObject({
      version: 1,
      kind: "smart-crop-render-report",
      assetId: "asset123",
      mode: "preview",
      cropPlanArtifactType: "smart-crop-plan-9x16-v1",
      target: { aspectRatio: "9:16", width: 1080, height: 1920 },
      segmentsRendered: 2,
      segmentsPlanned: 2,
      renderedSegments: [
        {
          shotId: "shot_00001",
          sourceStartSeconds: 0,
          sourceEndSeconds: 10,
          outputStartSeconds: 0,
          outputEndSeconds: 10,
          durationSeconds: 10,
        },
        {
          shotId: "shot_00002",
          sourceStartSeconds: 10,
          sourceEndSeconds: 25,
          outputStartSeconds: 10,
          outputEndSeconds: 25,
          durationSeconds: 15,
        },
      ],
      outputDurationSeconds: 25,
      previewFrameArtifactTypes: [
        "smart-crop-preview-frame-9x16-001",
        "smart-crop-preview-frame-9x16-002",
      ],
      warnings: [],
      tool: "crop-worker-render-v1",
      generatedAt: "2026-06-09T00:00:00.000Z",
    })
    expect(result.report.outputBytes).toBeGreaterThan(0)
    expect(result.report.renderSeconds).toBeGreaterThanOrEqual(0)

    expect(result.artifacts).toEqual([
      {
        assetId: "asset123",
        artifactType: "smart-crop-preview-9x16",
        ext: "mp4",
      },
      {
        assetId: "asset123",
        artifactType: "smart-crop-preview-frame-9x16-001",
        ext: "jpg",
      },
      {
        assetId: "asset123",
        artifactType: "smart-crop-preview-frame-9x16-002",
        ext: "jpg",
      },
      {
        assetId: "asset123",
        artifactType: "smart-crop-render-report-9x16-preview",
        ext: "json",
      },
    ])

    // Progress: per-segment messages capped at 0.9 before upload/report.
    expect(progress).toEqual([
      [0.45, "Rendering segment 1 of 2"],
      [0.9, "Rendering segment 2 of 2"],
    ])
  })

  it("renders an attempt preview with suffixed preview, frame, and report artifacts", async () => {
    await storage.writeArtifact({
      assetId: "asset123",
      artifactType: "smart-crop-plan-9x16-attempt-001-v1",
      ext: "json",
      body: JSON.stringify(plan),
      contentType: "application/json",
    })

    const result = await runRender({
      assetId: "asset123",
      sourceUrl,
      mode: "preview",
      cropPlanAssetId: "asset123",
      cropPlanArtifactType: "smart-crop-plan-9x16-attempt-001-v1",
      artifactSuffix: "attempt-001",
      previewFrameCount: 2,
      deps: {
        runCommand,
        storage,
        protocolWhitelist: whitelist,
        previewMaxSegments: 6,
        previewMaxSeconds: 90,
      },
    })

    await expect(
      storage.artifactExists(
        "asset123",
        "smart-crop-preview-9x16-attempt-001",
        "mp4",
      ),
    ).resolves.toBe(true)
    await expect(
      storage.artifactExists(
        "asset123",
        "smart-crop-preview-frame-9x16-001-attempt-001",
        "jpg",
      ),
    ).resolves.toBe(true)
    await expect(
      storage.artifactExists(
        "asset123",
        "smart-crop-render-report-9x16-preview-attempt-001",
        "json",
      ),
    ).resolves.toBe(true)

    expect(result.report).toMatchObject({
      cropPlanArtifactType: "smart-crop-plan-9x16-attempt-001-v1",
      artifactSuffix: "attempt-001",
      previewFrameArtifactTypes: [
        "smart-crop-preview-frame-9x16-001-attempt-001",
        "smart-crop-preview-frame-9x16-002-attempt-001",
      ],
      renderedSegments: [
        {
          shotId: "shot_00001",
          outputStartSeconds: 0,
          outputEndSeconds: 10,
        },
        {
          shotId: "shot_00002",
          outputStartSeconds: 10,
          outputEndSeconds: 25,
        },
      ],
    })

    expect(result.artifacts.map((artifact) => artifact.artifactType)).toEqual([
      "smart-crop-preview-9x16-attempt-001",
      "smart-crop-preview-frame-9x16-001-attempt-001",
      "smart-crop-preview-frame-9x16-002-attempt-001",
      "smart-crop-render-report-9x16-preview-attempt-001",
    ])
  })

  it("renders a localized job through the timeline map and records unmapped warnings", async () => {
    await storage.writeArtifact({
      assetId: "asset456",
      artifactType: TIMELINE_MAP_ARTIFACT_TYPE,
      ext: "json",
      body: JSON.stringify({
        version: 1,
        kind: "smart-crop-timeline-map",
        canonicalAssetId: "asset123",
        localizedAssetId: "asset456",
        language: "uk",
        mappingMethod: "shot-sequence",
        overallConfidence: 0.97,
        unmappedDurationPercent: 1.8,
        maxConsecutiveUnmappedSeconds: 4.2,
        segments: [
          {
            canonicalShotId: "shot_00001",
            canonicalStart: 0,
            canonicalEnd: 10,
            localizedStart: 2,
            localizedEnd: 13.5,
            confidence: 0.98,
          },
        ],
        gate: { passed: true, failures: [] },
        warnings: [],
        generatedAt: "2026-06-09T00:00:00.000Z",
      }),
      contentType: "application/json",
    })

    const result = await runRender({
      assetId: "asset456",
      sourceUrl,
      mode: "full",
      cropPlanAssetId: "asset123",
      timelineMapAssetId: "asset456",
      previewFrameCount: 0,
      deps: { runCommand, storage, protocolWhitelist: whitelist },
    })

    // Localized timing drives the segment seek.
    expect(ffmpegCalls[0]!.slice(0, 7)).toEqual([
      "-y",
      "-protocol_whitelist",
      whitelist,
      "-ss",
      "2",
      "-t",
      "11.5",
    ])

    expect(result.report.mode).toBe("full")
    expect(result.report.segmentsRendered).toBe(1)
    expect(result.report.previewFrameArtifactTypes).toEqual([])
    expect(result.report.warnings).toHaveLength(1)
    expect(result.report.warnings[0]).toContain("unmapped shot shot_00002")

    await expect(
      storage.artifactExists("asset456", "smart-crop-output-9x16", "mp4"),
    ).resolves.toBe(true)
    await expect(
      storage.artifactExists(
        "asset456",
        "smart-crop-render-report-9x16-full",
        "json",
      ),
    ).resolves.toBe(true)
  })

  it("fails when the crop plan artifact is missing", async () => {
    await expect(
      runRender({
        assetId: "asset999",
        sourceUrl,
        mode: "preview",
        cropPlanAssetId: "asset999",
        previewFrameCount: 0,
        deps: { runCommand, storage },
      }),
    ).rejects.toThrow(/failed to read crop plan artifact/)
  })

  it("fails when no segments remain after remapping", async () => {
    await storage.writeArtifact({
      assetId: "asset777",
      artifactType: TIMELINE_MAP_ARTIFACT_TYPE,
      ext: "json",
      body: JSON.stringify({
        version: 1,
        kind: "smart-crop-timeline-map",
        canonicalAssetId: "asset123",
        localizedAssetId: "asset777",
        language: "uk",
        mappingMethod: "shot-sequence",
        overallConfidence: 0.5,
        unmappedDurationPercent: 100,
        maxConsecutiveUnmappedSeconds: 25,
        segments: [],
        gate: { passed: false, failures: [] },
        warnings: [],
        generatedAt: "2026-06-09T00:00:00.000Z",
      }),
      contentType: "application/json",
    })

    await expect(
      runRender({
        assetId: "asset777",
        sourceUrl,
        mode: "full",
        cropPlanAssetId: "asset123",
        timelineMapAssetId: "asset777",
        previewFrameCount: 0,
        deps: { runCommand, storage },
      }),
    ).rejects.toThrow(/no renderable segments/)
  })

  it("fails with JobDeadlineExceededError when the job deadline passes between segments", async () => {
    let nowMs = 0
    // Each invocation "takes" 60ms against a 50ms job budget: segment 1 is
    // allowed to start (budget remaining), segment 2 must not be invoked.
    const slowRunCommand: RunCommand = async (command, args, options) => {
      await runCommand(command, args, options)
      nowMs += 60
      return { stdout: Buffer.alloc(0), stderr: "" }
    }
    const deadline = createJobDeadline(50, () => nowMs)

    const promise = runRender({
      assetId: "asset123",
      sourceUrl,
      mode: "preview",
      cropPlanAssetId: "asset123",
      previewFrameCount: 0,
      deps: { runCommand: slowRunCommand, storage, deadline },
    })
    await expect(promise).rejects.toThrow(JobDeadlineExceededError)
    await expect(promise).rejects.toThrow(/job deadline exceeded/)

    // Only segment 1 was invoked before the deadline tripped.
    expect(ffmpegCalls).toHaveLength(1)
  })

  it("caps each invocation's timeoutMs at the remaining job budget", async () => {
    let nowMs = 0
    const timeouts: Array<number | undefined> = []
    const cappedRunCommand: RunCommand = async (command, args, options) => {
      timeouts.push(options?.timeoutMs)
      await runCommand(command, args, options)
      nowMs += 30
      return { stdout: Buffer.alloc(0), stderr: "" }
    }

    const result = await runRender({
      assetId: "asset123",
      sourceUrl,
      mode: "preview",
      cropPlanAssetId: "asset123",
      previewFrameCount: 0,
      deps: {
        runCommand: cappedRunCommand,
        storage,
        timeoutMs: 1_000,
        deadline: createJobDeadline(100, () => nowMs),
      },
    })

    // seg1 at t=0 → min(1000, 100); seg2 at t=30 → 70; concat at t=60 → 40.
    expect(timeouts).toEqual([100, 70, 40])
    expect(result.report.segmentsRendered).toBe(2)
  })
})
