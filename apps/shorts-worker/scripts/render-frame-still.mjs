#!/usr/bin/env node
/**
 * Render a SINGLE frame of a devotional at an absolute frame number — a fast
 * placement check (e.g. verifying subtitle position on the video card) without
 * a full video render.
 *
 *   node scripts/render-frame-still.mjs --manifest=... --style=teal \
 *     --cover=bottomRule --anim=block --frame=633 --out=devo/artifacts/stills/x.png
 */
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { bundle } from "@remotion/bundler"
import {
  ensureBrowser,
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
function abs(p) {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p)
}

async function main() {
  const manifestPath = abs(arg("manifest", "devo/artifacts/hope/manifest.json"))
  const styleId = arg("style", "teal")
  // LAYOUT (arrangement), independent of --style. Omit for the filter's native
  // layout. centered | editorial | classic
  const layout = arg("layout", "")
  const textAnim = arg("anim", "block")
  const videoCardFilter = arg("vfilter", "")
  const mediaFilterOverride = arg("mfilter", "")
  const filmTreatment = arg("film", "false") === "true"
  const splitTone = arg("split", "false") === "true"
  const blurScale = arg("blurscale", "")
  const frame = Number(arg("frame", "633"))
  const out = abs(arg("out", "devo/artifacts/stills/frame.png"))

  const publicDir = await mkdtemp(path.join(tmpdir(), "devo-frame-"))
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const dir = path.dirname(manifestPath)
  const stage = async (n) => {
    if (n)
      await copyFile(path.join(dir, n), path.join(publicDir, n)).catch(() => {})
  }
  await stage(manifest.bgFile)
  await stage(manifest.musicFile)
  for (const c of manifest.cards) {
    await stage(c.audioFile)
    await stage(c.videoFile)
    await stage(c.bgFile)
  }
  await mkdir(path.dirname(out), { recursive: true })

  await ensureBrowser()
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    publicDir,
    webpackOverride: (c) => c,
  })
  const inputProps = {
    ...(arg("widetext", "") ? { wideText: arg("widetext", "") } : {}),
    headerDate: manifest.headerDate ?? "Today",
    cards: manifest.cards,
    audioDurationSec: manifest.cards.reduce(
      (s, c) => s + (c.durationSec ?? 0),
      0,
    ),
    style: styleId,
    ...(layout ? { layout } : {}),
    textAnim,
    showMuteButton: false,
    ...(videoCardFilter ? { videoCardFilter } : {}),
    ...(mediaFilterOverride ? { mediaFilterOverride } : {}),
    ...(filmTreatment ? { filmTreatment } : {}),
    ...(splitTone ? { splitTone } : {}),
    ...(blurScale ? { blurScale: Number(blurScale) } : {}),
    ...(arg("attribution", "") ? { attribution: arg("attribution", "") } : {}),
    ...(manifest.attribution ? { attribution: manifest.attribution } : {}),
    ...(manifest.bgFile ? { bgFile: manifest.bgFile } : {}),
    ...(manifest.bgPlaybackRate
      ? { bgPlaybackRate: manifest.bgPlaybackRate }
      : {}),
    ...(manifest.musicFile ? { musicFile: manifest.musicFile } : {}),
  }
  const composition = await selectComposition({
    serveUrl,
    id: arg("comp", "devotional"),
    inputProps,
  })
  await renderStill({ composition, serveUrl, output: out, frame, inputProps })
  console.log(`🖼  ${path.relative(REPO_ROOT, out)} @ frame ${frame}`)
  await rm(publicDir, { recursive: true, force: true }).catch(() => {})
}

main().catch((err) => {
  console.error("frame still failed:", err)
  process.exitCode = 1
})
