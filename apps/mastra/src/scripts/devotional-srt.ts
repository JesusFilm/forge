/**
 * Write a .srt subtitle file for an already-rendered long-form devotional,
 * from its manifest (no re-render, no TTS).
 *
 *   pnpm exec tsx src/scripts/devotional-srt.ts \
 *     --manifest="<video>.manifest.json" [--out="<video>.srt"] \
 *     [--cut=152.4667-162.3667] [--cut=...]
 *
 * --manifest also accepts a source pack folder (<video>.source/). --out
 * defaults to the manifest path with .srt. --cut removes a span cut out of
 * the mp4 after the render (seconds on the render's clock), shifting later
 * cues. The language is whatever the video speaks (the manifest's own text).
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

import {
  manifestToSrt,
  type SrtManifest,
} from "../services/devotional/devotional-srt"

const args = process.argv.slice(2)
const arg = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const all = (name: string) =>
  args
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.slice(name.length + 3))

let manifestPath = arg("manifest")
if (!manifestPath) {
  console.error(
    "usage: devotional-srt.ts --manifest=<video>.manifest.json [--out=<file>.srt] [--cut=a-b]",
  )
  process.exit(1)
}
if (existsSync(manifestPath) && statSync(manifestPath).isDirectory())
  manifestPath = path.join(manifestPath, "manifest.json")
const cuts = all("cut").map((c) => {
  const m = /^([\d.]+)-([\d.]+)$/.exec(c)
  if (!m) throw new Error(`--cut must look like 152.4-162.3, got ${c}`)
  return { fromSec: Number(m[1]), toSec: Number(m[2]) }
})
const out =
  arg("out") ?? manifestPath.replace(/(\.manifest)?\.json$/, "") + ".srt"
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SrtManifest
const srt = manifestToSrt(manifest, cuts)
writeFileSync(out, srt)
console.log(`${out}: ${srt.split("\n\n").length} cues`)
