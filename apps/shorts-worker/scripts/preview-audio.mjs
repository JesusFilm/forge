/**
 * Build the devotional's SOUNDTRACK from a staged manifest, without rendering.
 *
 * The Remotion pass is the slow step (minutes). Everything needed to hear how
 * the piece actually flows — the narration segments, the film clip's own
 * dialogue, the music bed — is already sitting in the stage directory next to
 * manifest.json, along with the exact durations the render will use. So the
 * review step "does the clip sit right against the voice" costs seconds, not a
 * full encode.
 *
 *   node apps/shorts-worker/scripts/preview-audio.mjs \
 *     --manifest=/tmp/devo-render-XXXX/manifest.json --out=~/Desktop/preview.m4a
 *
 * What it does NOT show: any picture, any text, any card animation. It is the
 * soundtrack on the render's real clock, nothing more.
 */
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"

/** Breath pad after every card — CARD_TAIL_FRAMES (24 @ 30fps) in timing.ts. */
const CARD_TAIL_SEC = 0.8

function arg(name, fallback = "") {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const c = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })
    let err = ""
    c.stderr.on("data", (d) => {
      err += d.toString()
    })
    c.on("error", reject)
    c.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `ffmpeg exit ${code}: ${err
                .split("\n")
                .filter((l) => /error|Error|Invalid|No such/.test(l))
                .join("; ")
                .slice(0, 700)}`,
            ),
          ),
    )
  })
}

async function main() {
  const manifestPath = arg("manifest")
  const out = arg("out")
  if (!manifestPath || !out) {
    throw new Error("--manifest=<manifest.json> and --out=<file.m4a> required")
  }
  const dir = path.dirname(manifestPath)
  const m = JSON.parse(await readFile(manifestPath, "utf8"))
  const musicVol = Number(arg("music-vol", "0.22"))
  const clipVol = Number(arg("clip-vol", "0.95"))

  // Lay the cards out on the SAME clock the composition uses: an intro hold,
  // then each card's own audio length plus its hold plus the tail pad.
  let t = Number(m.introHoldSec ?? 1)
  const inputs = []
  // ffmpeg input INDEX, which is not inputs.length: each input contributes two
  // or more argv entries ("-i", path), so counting the array gave 0,2,4,... and
  // the music stream ended up addressed as [18:a] on a nine-input graph.
  let nextInput = 0
  const filters = []
  const labels = []
  const plan = []

  for (const card of m.cards ?? []) {
    const dur = Number(card.durationSec ?? 0)
    const hold = Number(card.holdSec ?? 0)
    // A card either narrates (audioFile) or is the film itself (videoFile).
    const src = card.audioFile ?? card.videoFile
    if (src) {
      const i = nextInput++
      inputs.push("-i", path.join(dir, src))
      const isClip = !card.audioFile && card.videoFile
      // The clip opens muted for its silent lead, then fades up — the same
      // shape the composition gives it, so the balance is judgeable here.
      const lead = isClip ? Number(card.mutedLeadSec ?? 0) : 0
      const vol = isClip ? clipVol : 1
      const label = `a${i}`
      filters.push(
        `[${i}:a]atrim=0:${dur.toFixed(3)},asetpts=N/SR/TB,` +
          `volume=${vol}` +
          (lead > 0 ? `,afade=t=in:st=${lead.toFixed(2)}:d=0.6` : "") +
          `,adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)}[${label}]`,
      )
      labels.push(`[${label}]`)
      plan.push(
        `${t.toFixed(1).padStart(7)}s  ${String(card.kind).padEnd(18)} ${dur.toFixed(1)}s` +
          (hold ? ` +${hold}s hold` : "") +
          (isClip ? "  (film audio)" : ""),
      )
    }
    t += dur + hold + CARD_TAIL_SEC
  }
  const totalSec = t + Number(m.outroHoldSec ?? 8)

  if (labels.length === 0) throw new Error("manifest has no playable audio")

  // Music last so its index is known, looped to cover the whole thing.
  if (m.musicFile) {
    const i = nextInput++
    inputs.push("-stream_loop", "-1", "-i", path.join(dir, m.musicFile))
    filters.push(
      `[${i}:a]atrim=0:${totalSec.toFixed(3)},asetpts=N/SR/TB,` +
        `volume=${musicVol},afade=t=out:st=${(totalSec - 3).toFixed(2)}:d=3[mus]`,
    )
    labels.push("[mus]")
  }

  filters.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,` +
      `alimiter=limit=0.97[mix]`,
  )

  console.log(plan.join("\n"))
  console.log(`\ntotal ${totalSec.toFixed(1)}s → ${out}`)

  await ffmpeg([
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[mix]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    out,
  ])
  console.log("done")
}

main().catch((e) => {
  console.error("preview-audio failed:", e.message ?? e)
  process.exitCode = 1
})
