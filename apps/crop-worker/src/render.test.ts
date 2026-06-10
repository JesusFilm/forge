import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
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
      "crop=606:1080:'520+40*min(t/6,1)':0,scale=1080:1920:flags=lanczos,setsar=1",
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
    ).toBe("crop=606:1080:'100':0,scale=1080:1920:flags=lanczos,setsar=1")
  })

  it("throws for a segment without keyframes", () => {
    expect(() => buildCropFilter({ ...baseSegment, keyframes: [] })).toThrow(
      /no crop keyframes/,
    )
  })
})

describe("runRender", () => {
  const sourceUrl = "https://stream.example.test/pb.m3u8"
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
        previewMaxSegments: 6,
        previewMaxSeconds: 90,
        now: () => new Date("2026-06-09T00:00:00.000Z"),
      },
      onProgress: (value, message) => progress.push([value, message]),
    })

    // Segment 1: animated pan, input-seek args in the documented order.
    const firstSegmentArgs = ffmpegCalls[0]!
    expect(firstSegmentArgs.slice(0, 9)).toEqual([
      "-y",
      "-ss",
      "0",
      "-t",
      "10",
      "-i",
      sourceUrl,
      "-vf",
      "crop=606:1080:'520+40*min(t/10,1)':0,scale=1080:1920:flags=lanczos,setsar=1",
    ])
    expect(firstSegmentArgs.slice(9, -1)).toEqual([
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

    // Concat call shape.
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

    // Frame extraction calls: output duration 25, two frames at 6.25/18.75.
    const frameCalls = ffmpegCalls.filter((args) => args.includes("-frames:v"))
    expect(frameCalls.map((args) => args[2])).toEqual(["6.25", "18.75"])
    expect(frameCalls[0]!.slice(0, 2)).toEqual(["-y", "-ss"])
    expect(frameCalls[0]).toContain("-q:v")

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
      target: { aspectRatio: "9:16", width: 1080, height: 1920 },
      segmentsRendered: 2,
      segmentsPlanned: 2,
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
      deps: { runCommand, storage },
    })

    // Localized timing drives the segment seek.
    expect(ffmpegCalls[0]!.slice(0, 5)).toEqual([
      "-y",
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
})
