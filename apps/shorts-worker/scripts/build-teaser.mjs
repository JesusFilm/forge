#!/usr/bin/env node
/**
 * Build 30-second social teasers from a finished devotional manifest.
 *
 * Produces FOUR approaches (all 9:16, muted-friendly text, verse front-and-
 * centre, ending on a CTA card). Each teaser reuses the devo's own film clip +
 * music; text cards carry no narration (social autoplays silent) — the on-screen
 * text and music carry it, so timing is fully under our control.
 *
 *   node apps/shorts-worker/scripts/build-teaser.mjs --manifest=devo/artifacts/refuge/manifest.json
 *
 * Then render each with:
 *   render-devotional-video.mjs --manifest=devo/artifacts/teasers/refuge/A-truncated/manifest.json \
 *     --style=splittone --layout=grounded --anim=letters --outro=2 --out=...
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../..")

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
function abs(p) {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p)
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]
/** Today's real date, short form (e.g. "Jul 9"), constant across the teaser. */
function todayLabel() {
  const n = new Date()
  return `${MONTHS[n.getMonth()]} ${n.getDate()}`
}

const CTA_HEADLINE = arg("cta-headline", "Watch the full devotional")
const CTA_HANDLE = arg("cta-handle", "@gospelmedialab")
const CTA_URL = arg("cta-url", "jesusfilm.org/watch")

// Card factories — every card gets the clip as its (blurred) background; the
// video card plays the clip clear. No audioFile → music-only, muted-friendly.
const cover = (d, f) => ({
  kind: "cover",
  durationSec: d,
  bgFile: "clip.mp4",
  ...f,
})
const verse = (d, f) => ({
  kind: "scripture",
  durationSec: d,
  bgFile: "clip.mp4",
  ...f,
})
const clip = (d) => ({ kind: "video", durationSec: d, videoFile: "clip.mp4" })
const cta = (d, headline) => ({
  kind: "cta",
  durationSec: d,
  bgFile: "clip.mp4",
  ctaHeadline: headline ?? CTA_HEADLINE,
  ctaHandle: CTA_HANDLE,
  ctaUrl: CTA_URL,
})

/**
 * Four approaches. Durations are tuned so that with `--outro=2` at render time
 * each lands around 27–30s (intro hold 0.8s + per-card 0.4s tails + 2s outro).
 */
function approaches(src) {
  const c = { title: src.cover.title, highlight: src.cover.highlight }
  const v = {
    verse: src.scripture.verse,
    citation: src.scripture.citation,
    highlight: src.scripture.highlight,
  }
  return {
    // 1) Truncated open — the devo's real opening, tightened, then CTA.
    "A-truncated": [cover(3.5, c), verse(7, v), clip(11), cta(2)],
    // 2) Cold open — start ON the footage, then hook + verse, then CTA.
    "B-coldopen": [clip(9), cover(3.5, c), verse(8, v), cta(2)],
    // 3) Verse-forward — the scripture is the hero (big, held), a taste of film, CTA.
    "C-verse": [verse(9, v), clip(12), cta(2)],
    // 4) Cliffhanger — hook, the clip building and cutting before the payoff,
    //    verse, then a "see how it ends" CTA.
    "D-cliffhanger": [
      cover(3.5, c),
      clip(14),
      verse(6, v),
      cta(2.5, "See how it ends —"),
    ],
  }
}

async function main() {
  const manifestPath = abs(
    arg("manifest", "devo/artifacts/refuge/manifest.json"),
  )
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  const srcDir = path.dirname(manifestPath)
  const devoName = path.basename(srcDir)

  const find = (k) => manifest.cards.find((x) => x.kind === k) || {}
  const src = {
    cover: find("cover"),
    scripture: find("scripture"),
    video: find("video"),
  }
  if (!src.video.videoFile)
    throw new Error("source devo has no video card / clip")
  if (!src.scripture.verse)
    throw new Error("source devo has no scripture verse")

  const clipSrc = path.join(srcDir, src.video.videoFile)
  const musicName = manifest.musicFile // e.g. music.mp3
  const outRoot = path.join(REPO_ROOT, "devo/artifacts/teasers", devoName)

  const all = approaches(src)
  for (const [name, cards] of Object.entries(all)) {
    const dir = path.join(outRoot, name)
    await mkdir(dir, { recursive: true })
    await copyFile(clipSrc, path.join(dir, "clip.mp4"))
    if (musicName) {
      try {
        await copyFile(path.join(srcDir, musicName), path.join(dir, musicName))
      } catch {
        // Music is optional; keep producing silent teasers when it is unavailable.
      }
    }
    const teaser = {
      schemaVersion: "2",
      headerDate: todayLabel(),
      ...(musicName ? { musicFile: musicName } : {}),
      cards,
    }
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify(teaser, null, 2) + "\n",
      "utf8",
    )
    const total = cards.reduce((s, x) => s + x.durationSec + 0.4, 0) + 0.8 + 2
    console.log(
      `  ✓ ${name}  (${cards.length} cards, ~${total.toFixed(1)}s)  ${path.relative(REPO_ROOT, dir)}`,
    )
  }
  console.log(
    `\n✅ 4 teasers for "${devoName}" → ${path.relative(REPO_ROOT, outRoot)}`,
  )
}

main().catch((e) => {
  console.error("teaser build failed:", e instanceof Error ? e.message : e)
  process.exitCode = 1
})
