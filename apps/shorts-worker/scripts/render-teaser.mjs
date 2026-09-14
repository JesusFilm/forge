#!/usr/bin/env node
/**
 * Local Remotion render for a devotional TEASER (vertical, footage + text).
 * Sibling of render-devotional-video.mjs — same bundle entry, different
 * composition, far fewer inputs.
 *
 * Usage (from the repo root):
 *   node apps/shorts-worker/scripts/render-teaser.mjs \
 *     --clip=/path/to/clip.mp4 --out=devo/artifacts/video/teaser.mp4 \
 *     [--reveal=17] [--music=devo/assets/music/hope-1.mp3|none]
 *     [--sfx=devo/assets/sfx/inshot-transition-03.wav|none]
 *     [--lines=devo/assets/teaser/good-samaritan/lines.json|none] [--stills=6] [--at=7.5,19.5]
 */
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { bundle } from "@remotion/bundler"
import {
  ensureBrowser,
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../..")
const ENTRY = path.join(
  REPO_ROOT,
  "packages/shorts-compositions/src/devotional/entry.ts",
)

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p))

async function main() {
  const clipArg = arg("clip", "")
  if (!clipArg) throw new Error("--clip=<mp4> is required")
  const clip = abs(clipArg)
  const outPath = abs(arg("out", "devo/artifacts/video/teaser.mp4"))
  const reveal = Number(arg("reveal", "17"))
  // Music bed + per-word sound. Defaults: the library bed the Good Samaritan
  // devotional itself used, and the synthesized soft "shh" in devo/assets/sfx.
  const music = arg("music", "devo/assets/music/hope-1.mp3")
  const sfx = arg("sfx", "devo/assets/sfx/inshot-transition-03.wav")
  // Narrated lines: a lines.json written by apps/mastra teaser-voice.ts, with
  // the mp3s beside it. "none" renders the silent, evenly-paced fallback.
  const linesArg = arg("lines", "devo/assets/teaser/good-samaritan/lines.json")
  const stillsCount = Number(arg("stills", "")) || 0
  // Exact seconds to still, e.g. --at=7.5,12.6,19.45 — for checking specific
  // beats rather than an even spread.
  const atArg = arg("at", "")
  const atSecs = atArg
    ? atArg
        .split(",")
        .map((s) => Number(s.trim()))
        .filter(Number.isFinite)
    : []
  const frameRangeArg = arg("frame-range", "")
  const frameRange = frameRangeArg
    ? frameRangeArg.split("-").map((s) => Number(s.trim()))
    : null

  const publicDir = await mkdtemp(path.join(tmpdir(), "devo-teaser-"))
  try {
    const clipFile = "teaser-clip.mp4"
    await copyFile(clip, path.join(publicDir, clipFile))
    const inputProps = { clipFile, revealSourceSec: reveal }
    if (music && music !== "none") {
      const musicFile = `teaser-music${path.extname(music)}`
      await copyFile(abs(music), path.join(publicDir, musicFile))
      inputProps.musicFile = musicFile
    }
    if (sfx && sfx !== "none") {
      const sfxFile = `teaser-sfx${path.extname(sfx)}`
      await copyFile(abs(sfx), path.join(publicDir, sfxFile))
      inputProps.sfxFile = sfxFile
    }
    if (linesArg && linesArg !== "none") {
      const linesPath = abs(linesArg)
      const manifest = JSON.parse(await readFile(linesPath, "utf8"))
      const dir = path.dirname(linesPath)
      inputProps.lines = []
      for (const line of manifest.lines) {
        const file = `teaser-line-${line.id}.mp3`
        await copyFile(path.join(dir, line.file), path.join(publicDir, file))
        inputProps.lines.push({
          id: line.id,
          text: line.text,
          file,
          durationSec: line.durationSec,
          words: line.words,
        })
      }
    }

    await ensureBrowser()
    console.log("Bundling…")
    const serveUrl = await bundle({
      entryPoint: ENTRY,
      publicDir,
      webpackOverride: (c) => c,
    })
    const composition = await selectComposition({
      serveUrl,
      id: "devotional-teaser",
      inputProps,
    })
    await mkdir(path.dirname(outPath), { recursive: true })

    if (stillsCount > 0 || atSecs.length > 0) {
      const last = composition.durationInFrames - 1
      const frames =
        atSecs.length > 0
          ? atSecs.map((sec) =>
              Math.min(Math.round(sec * composition.fps), last),
            )
          : Array.from({ length: stillsCount }, (_, i) =>
              Math.round((i / (stillsCount - 1)) * last),
            )
      const base = outPath.replace(/\.mp4$/, "")
      for (const [i, f] of frames.entries()) {
        const output = `${base}-still-${String(i + 1).padStart(2, "0")}.png`
        await renderStill({
          composition,
          serveUrl,
          output,
          frame: f,
          inputProps,
        })
        console.log(
          `  still frame ${f} (${(f / composition.fps).toFixed(1)}s) → ${output}`,
        )
      }
      return
    }

    console.log(
      `Rendering ${composition.durationInFrames} frames (${(composition.durationInFrames / composition.fps).toFixed(1)}s)…`,
    )
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      jpegQuality: 95,
      crf: 16,
      ...(frameRange && frameRange.length === 2 ? { frameRange } : {}),
      onProgress: ({ progress }) => {
        if (Math.round(progress * 100) % 10 === 0)
          process.stdout.write(`\r  ${Math.round(progress * 100)}%   `)
      },
    })
    console.log(`\n🎬 done: ${outPath}`)
  } finally {
    await rm(publicDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error("render failed:", err)
  process.exitCode = 1
})
