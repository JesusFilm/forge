import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  mkdir,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  collectManifestFiles,
  filmFiles,
  sourcePackDir,
  writeSourcePack,
} from "./source-pack"

const render = {
  comp: "devotional-wide",
  style: "restored",
  layout: "grounded",
  musicVolume: 0.2,
  xfadeSec: 1.2,
  videoAudioLevel: 0.6,
  options: { textFont: "serif" },
}

const manifest = {
  bgFile: "bg.mp4",
  musicFile: "music.mp3",
  cards: [
    { kind: "video", videoFile: "clip.mp4", durationSec: 30 },
    { kind: "step", audioFile: "01-step.mp3", bgFile: "bg.mp4" },
    { kind: "reflection-full", audioFile: "02-reflection.mp3" },
  ],
}

async function stageWith(files: string[]): Promise<string> {
  const stage = await mkdtemp(path.join(tmpdir(), "source-pack-stage-"))
  for (const f of files) await writeFile(path.join(stage, f), `bytes of ${f}`)
  // Present in a real stage but not referenced: must NOT be packed.
  await writeFile(path.join(stage, "full.mp4"), "whole film")
  return stage
}

describe("collectManifestFiles", () => {
  it("finds every *File key at any depth, deduped and sorted", () => {
    expect(collectManifestFiles(manifest)).toEqual([
      "01-step.mp3",
      "02-reflection.mp3",
      "bg.mp4",
      "clip.mp4",
      "music.mp3",
    ])
  })

  it("picks up an asset key it has never heard of", () => {
    expect(
      collectManifestFiles({ cards: [{ overlayFile: "mark.png" }] }),
    ).toEqual(["mark.png"])
  })

  it("refuses paths that leave the stage", () => {
    expect(() => collectManifestFiles({ audioFile: "../x.mp3" })).toThrow(
      /not a staged file/,
    )
    expect(() => collectManifestFiles({ bgFile: "/etc/passwd" })).toThrow(
      /not a staged file/,
    )
  })
})

describe("filmFiles", () => {
  it("counts a clip as film even when another card also uses it as bgFile", () => {
    expect([
      ...filmFiles({
        bgFile: "bg.mp4",
        cards: [
          { kind: "step", bgFile: "clip.mp4" },
          { kind: "video", videoFile: "clip.mp4" },
        ],
      }),
    ]).toEqual(["clip.mp4"])
  })
})

describe("sourcePackDir", () => {
  it("sits next to the video, named after it", () => {
    expect(sourcePackDir("/out/prodigal-seq0-wide-v2.mp4")).toBe(
      "/out/prodigal-seq0-wide-v2.source",
    )
  })
})

describe("writeSourcePack", () => {
  it("packs manifest, text, render settings and only the referenced files", async () => {
    const files = collectManifestFiles(manifest)
    const stage = await stageWith(files)
    const out = await mkdtemp(path.join(tmpdir(), "source-pack-out-"))
    const transcoded: Record<string, number> = {}
    const dir = await writeSourcePack({
      stage,
      manifest,
      videoPath: path.join(out, "prodigal-seq0-wide.mp4"),
      devotional: { reflection: { paragraphs: [{ role: "history" }] } },
      render,
      transcode: async (src, dest, crf) => {
        transcoded[path.basename(src)] = crf
        await copyFile(src, dest)
      },
    })

    expect(dir).toBe(path.join(out, "prodigal-seq0-wide.source"))
    expect((await readdir(dir)).sort()).toEqual(
      [...files, "devotional.json", "manifest.json", "render.json"].sort(),
    )
    // Videos go through the encoder; audio is copied byte for byte.
    expect(transcoded).toEqual({ "bg.mp4": 23, "clip.mp4": 20 })
    expect(await readFile(path.join(dir, "01-step.mp3"), "utf8")).toBe(
      "bytes of 01-step.mp3",
    )
    expect(
      JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")),
    ).toEqual(manifest)
    const meta = JSON.parse(
      await readFile(path.join(dir, "render.json"), "utf8"),
    )
    expect(meta).toMatchObject({
      version: 1,
      video: "prodigal-seq0-wide.mp4",
      comp: "devotional-wide",
      options: { textFont: "serif" },
    })
    // No temp dir left behind.
    expect((await readdir(out)).sort()).toEqual(["prodigal-seq0-wide.source"])
  })

  it("moves an older pack of the same name to archive/ instead of overwriting it", async () => {
    const stage = await stageWith(collectManifestFiles(manifest))
    const out = await mkdtemp(path.join(tmpdir(), "source-pack-out-"))
    const old = path.join(out, "prodigal-seq0.source")
    await mkdir(old)
    await writeFile(path.join(old, "manifest.json"), "the old take")

    await writeSourcePack({
      stage,
      manifest,
      videoPath: path.join(out, "prodigal-seq0.mp4"),
      devotional: {},
      render,
      transcode: (src, dest) => copyFile(src, dest),
    })

    const archived = await readdir(path.join(out, "archive"))
    expect(archived).toHaveLength(1)
    expect(archived[0]).toMatch(/^prodigal-seq0\.source-/)
    expect(
      await readFile(
        path.join(out, "archive", archived[0], "manifest.json"),
        "utf8",
      ),
    ).toBe("the old take")
  })

  it("leaves nothing behind when a staged file is missing", async () => {
    const stage = await stageWith(["bg.mp4"]) // clip.mp4 and audio missing
    const out = await mkdtemp(path.join(tmpdir(), "source-pack-out-"))
    await expect(
      writeSourcePack({
        stage,
        manifest,
        videoPath: path.join(out, "x.mp4"),
        devotional: {},
        render,
        transcode: (src, dest) => copyFile(src, dest),
      }),
    ).rejects.toThrow()
    expect(await readdir(out)).toEqual([])
  })
})
