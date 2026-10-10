#!/usr/bin/env node
/**
 * Render cover stills of a devotional under several color-grade filters — fast
 * preview (one bundle, many stills), no full video render.
 *
 *   node scripts/render-cover-still.mjs --manifest=... --style=sepia \
 *     --cover=frosted --frame=45 --outdir=devo/artifacts/stills
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

// CSS-filter grade presets to preview. (Teal-orange is approximate — a true
// split-tone needs baked grading, not a live CSS filter.)
const PRESETS = [
  ["01-original", ""],
  ["02-warm", "sepia(0.32) saturate(1.5) hue-rotate(-12deg) brightness(1.03)"],
  ["03-sepia", "sepia(0.7) saturate(1.55) hue-rotate(-18deg) contrast(1.02)"],
  ["04-teal-orange", "saturate(1.3) contrast(1.12) hue-rotate(-6deg)"],
  ["05-muted", "saturate(0.5) contrast(0.96) brightness(1.06)"],
  ["06-cool", "sepia(0.3) hue-rotate(160deg) saturate(1.3) brightness(1.02)"],
]

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
function abs(p) {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p)
}

async function main() {
  const manifestPath = abs(
    arg("manifest", "devo/artifacts/weary/manifest.json"),
  )
  const styleId = arg("style", "sepia")
  const layout = arg("layout", "") // centered | editorial | classic (blank = filter native)
  const frame = Number(arg("frame", "45"))
  const outdir = abs(arg("outdir", "devo/artifacts/stills"))

  const publicDir = await mkdtemp(path.join(tmpdir(), "devo-still-"))
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const dir = path.dirname(manifestPath)
  const stage = async (n) => {
    if (n)
      await copyFile(path.join(dir, n), path.join(publicDir, n)).catch(() => {})
  }
  await stage(manifest.bgFile)
  for (const c of manifest.cards) {
    await stage(c.audioFile)
    await stage(c.videoFile)
    await stage(c.bgFile)
  }
  await mkdir(outdir, { recursive: true })

  await ensureBrowser()
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    publicDir,
    webpackOverride: (c) => c,
  })

  for (const [name, filter] of PRESETS) {
    const inputProps = {
      headerDate: manifest.headerDate ?? "Today",
      cards: manifest.cards,
      audioDurationSec: manifest.cards.reduce(
        (s, c) => s + (c.durationSec ?? 0),
        0,
      ),
      style: styleId,
      ...(layout ? { layout } : {}),
      ...(manifest.bgFile ? { bgFile: manifest.bgFile } : {}),
      ...(filter ? { mediaFilterOverride: filter } : {}),
    }
    const composition = await selectComposition({
      serveUrl,
      id: "devotional",
      inputProps,
    })
    const out = path.join(outdir, `${name}.png`)
    await renderStill({ composition, serveUrl, output: out, frame, inputProps })
    console.log(`🖼  ${name}`)
  }
  await rm(publicDir, { recursive: true, force: true }).catch(() => {})
}

main().catch((err) => {
  console.error("still failed:", err)
  process.exitCode = 1
})
