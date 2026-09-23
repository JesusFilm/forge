import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { studioInspectionContextSchema } from "@forge/studio-contracts/inspection"
import {
  extractStudioInspection,
  planStudioInspection,
  incompleteStudioInspection,
  boundStudioInspectionEvidence,
} from "./studio-inspection-output"

const reference = {
  assetId: "fixture",
  versionId: "fixture-v1",
  digest: "a".repeat(64),
}
const document = studioDocumentSchema.parse({
  version: 1,
  title: "Inspection fixture",
  language: "en",
  runtimeVersion: "fixture",
  width: 320,
  height: 180,
  fps: 30,
  durationInFrames: 120,
  tracks: [
    { id: "visual", kind: "visual" },
    { id: "voice", kind: "audio" },
  ],
  components: [],
  packRevisionIds: [],
  items: [
    {
      id: "first",
      kind: "image",
      trackId: "visual",
      startFrame: 0,
      durationInFrames: 60,
      asset: reference,
    },
    {
      id: "second",
      kind: "image",
      trackId: "visual",
      startFrame: 60,
      durationInFrames: 60,
      asset: reference,
    },
    {
      id: "voice",
      kind: "audio",
      trackId: "voice",
      startFrame: 0,
      durationInFrames: 120,
      asset: reference,
      sourceStartMs: 0,
      volume: 1,
    },
  ],
})
function context(bytes: Buffer, doc = document) {
  return studioInspectionContextSchema.parse({
    projectId: "project",
    attemptId: "render",
    revision: 1,
    currentRevision: 1,
    stale: false,
    inputHash: "b".repeat(64),
    output: {
      ...reference,
      digest: createHash("sha256").update(bytes).digest("hex"),
    },
    document: doc,
    outputReadyAt: new Date().toISOString(),
    evidence: null,
  })
}
test("samples actual cuts across the timeline and distinguishes authored uncovered gaps from overflow hints", () => {
  const doc = studioDocumentSchema.parse({
    ...document,
    items: [
      { ...document.items[0], durationInFrames: 30 },
      { ...document.items[1], startFrame: 60 },
      {
        id: "overflow",
        kind: "text",
        trackId: "visual",
        startFrame: 60,
        durationInFrames: 60,
        text: "long ".repeat(100),
        properties: { fontSize: 100 },
      },
    ],
  })
  const plan = planStudioInspection(doc)
  expect(plan.samples.map((s) => s.frame)).toEqual(
    expect.arrayContaining([29, 30, 59, 60]),
  )
  expect(plan.authoredGaps).toEqual([{ startMs: 1000, endMs: 2000 }])
  expect(plan.findings.map((f) => f.code)).toContain("potential-text-overflow")
  expect(plan.samples.length).toBeLessThanOrEqual(12)
})
test("does not pretend missing binaries or changed output bytes were inspected", async () => {
  const bytes = Buffer.from("transport fixture")
  const evidence = await extractStudioInspection(context(bytes), bytes, {
    ffmpeg: "/nonexistent/shorts-ffmpeg",
    ffprobe: "/nonexistent/shorts-ffprobe",
  })
  expect(evidence.status).toBe("unsupported")
  expect(evidence.samples).toEqual([])
  expect(evidence.coverage.audio.status).toBe("unavailable")
  await expect(
    extractStudioInspection(context(bytes), Buffer.from("changed"), {
      ffmpeg: "none",
      ffprobe: "none",
    }),
  ).rejects.toThrow("digest")
})
const ffmpeg = process.env.STUDIO_FFMPEG_PATH,
  ffprobe = process.env.STUDIO_FFPROBE_PATH
;(ffmpeg && ffprobe ? test : test.skip)(
  "decodes real MP4 samples and flags an output black cut and silent expected audio",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "inspection-test-"))
    try {
      for (const bad of [false, true]) {
        const file = join(dir, `${bad}.mp4`)
        execFileSync(
          ffmpeg!,
          [
            "-v",
            "error",
            "-nostdin",
            "-threads",
            "1",
            "-f",
            "lavfi",
            "-i",
            "color=blue:s=320x180:r=30:d=4",
            "-f",
            "lavfi",
            "-i",
            bad
              ? "anullsrc=r=48000:cl=mono"
              : "sine=frequency=880:sample_rate=48000:duration=4",
            "-vf",
            bad
              ? "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,1.9,2.1)'"
              : "null",
            "-filter_threads",
            "1",
            "-threads",
            "1",
            "-t",
            "4",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            file,
          ],
          { timeout: 10000 },
        )
        const bytes = await readFile(file)
        const evidence = await extractStudioInspection(context(bytes), bytes, {
          ffmpeg: ffmpeg!,
          ffprobe: ffprobe!,
        })
        expect(evidence.status).toBe("sampled")
        expect(evidence.samples.length).toBeGreaterThanOrEqual(4)
        expect(
          evidence.samples.every((s) =>
            Buffer.from(s.image.data, "base64")
              .subarray(0, 2)
              .equals(Buffer.from([255, 216])),
          ),
        ).toBe(true)
        expect(evidence.findings.some((f) => f.code === "sampled-black")).toBe(
          bad,
        )
        expect(evidence.findings.some((f) => f.code === "audio-silence")).toBe(
          bad,
        )
        expect(evidence.coverage.audio.endMs).toBeGreaterThan(3900)
        expect(evidence.preparationMs).toBeLessThan(45000)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  60000,
)

test("whole-report budget trims advisory text without pretending every warning fit", () => {
  const report = incompleteStudioInspection(
    context(Buffer.from("bytes")),
    Date.now(),
    "fixture",
  )
  report.findings = Array.from({ length: 1000 }, () => ({
    code: "potential-text-overflow",
    basis: "timeline-heuristic",
    message: "x".repeat(1000),
  }))
  const bounded = boundStudioInspectionEvidence(report)
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(450000)
  expect(bounded.findings.length).toBeLessThan(1000)
  expect(bounded.limitations.some((s) => s.includes("omitted"))).toBe(true)
})
