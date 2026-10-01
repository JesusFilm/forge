/**
 * Cut a finished devotional into vertical shorts (feat-573).
 *
 *   pnpm --filter @forge/mastra exec tsx src/scripts/cut-devotional-shorts.ts \
 *     --from="<video>.source" --out="$HOME/Desktop/Social Media/Prodigal/shorts" \
 *     [--only=language,history] [--stills] \
 *     [--film-turn=139.1-172.6] [--reflection=0-1] [--no-model]
 *
 * The turn of the film scene is chosen by a model (one small OpenRouter call,
 * needs `--env-file=.env.local`) unless `--film-turn` names it or
 * `--no-model` skips that short.
 *
 * Reads the source pack a render leaves beside its MP4 (source-pack.ts; make
 * one for an older devotional with `render-one-devotional.ts ... --pack-only`)
 * and renders each short in 9:16 through the same composition. No narration
 * is synthesised: every short plays the long form's own recorded audio.
 *
 * `--stills` renders three PNG frames per short instead of the MP4s, for a
 * look before the full encode. The intro teaser is not cut here; it has its
 * own command (`render-one-devotional.ts --teaser-intro`).
 */
import { spawn } from "node:child_process"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  nextFreePath,
  runRender,
} from "../services/devotional/devotional-render"
import { getDevotionalModel } from "../config/env"
import { createDevotionalLlm } from "../services/devotional/llm"
import {
  SHORT_KINDS,
  buildShortManifest,
  chooseFilmTurn,
  planCutdown,
  type CutdownOverrides,
  type DevotionalText,
  type Manifest,
  type ShortKind,
  type ShortPlan,
} from "../services/devotional/shorts-cutdown"
import {
  collectManifestFiles,
  type SourcePackRender,
} from "../services/devotional/source-pack"

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function range(name: string): { a: number; b: number } | undefined {
  const v = arg(name)
  if (!v) return undefined
  const m = /^([\d.]+)-([\d.]+)$/.exec(v)
  if (!m) throw new Error(`--${name} must look like 12.5-40`)
  return { a: Number(m[1]), b: Number(m[2]) }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    c.stdout.on("data", (d) => (out += d.toString()))
    c.stderr.on("data", (d) => (out += d.toString()))
    c.on("error", reject)
    c.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${cmd} exit ${code}: ${out.slice(-500)}`)),
    )
  })
}

/** Cut the film window out of the pack's clip, frame-accurate. */
async function trimFilm(
  src: string,
  dest: string,
  fromSec: number,
  toSec: number,
) {
  await run("ffmpeg", [
    "-y",
    "-ss",
    fromSec.toFixed(3),
    "-i",
    src,
    "-t",
    (toSec - fromSec).toFixed(3),
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    dest,
  ])
}

type Qa = { durationSec: number; lufs: number | null; blackSec: number }

/** The checks the long form gets: length, loudness, black frames. */
async function qa(file: string): Promise<Qa> {
  const dur = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ])
  const loud = await run("ffmpeg", [
    "-nostats",
    "-i",
    file,
    "-af",
    "ebur128",
    "-f",
    "null",
    "-",
  ])
  const lufs = /I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(loud)
  const black = await run("ffmpeg", [
    "-nostats",
    "-i",
    file,
    "-vf",
    "blackdetect=d=0.5:pix_th=0.05",
    "-an",
    "-f",
    "null",
    "-",
  ])
  // The fade in and out at the very ends are deliberate; count the rest.
  const total = Number(dur.trim())
  const blackSec = [
    ...black.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g),
  ]
    .map((m) => [Number(m[1]), Number(m[2])] as const)
    .filter(([s, e]) => s > 1 && e < total - 1.2)
    .reduce((acc, [s, e]) => acc + (e - s), 0)
  return { durationSec: total, lufs: lufs ? Number(lufs[1]) : null, blackSec }
}

/** What the short says, for shorts.md. */
function spokenText(m: Manifest, plan: ShortPlan): string {
  return plan.cards
    .map((i) => {
      const c = m.cards[i]
      if (c.kind === "video" && plan.film) {
        return (c.subtitles ?? [])
          .filter(
            (s) =>
              s.endSec > plan.film!.fromSec && s.startSec < plan.film!.toSec,
          )
          .map((s) => s.text)
          .join(" ")
      }
      if (c.kind === "questions") {
        const q = (c.questions as string[] | undefined) ?? []
        return [...q, String(c.prayer ?? "")].join(" ")
      }
      return c.text ?? ""
    })
    .join(" ")
}

async function main() {
  const from = arg("from")
  const outDir = arg("out")
  if (!from || !outDir)
    throw new Error("--from=<video>.source and --out=<dir> are required")
  const stills = process.argv.includes("--stills")
  const only = arg("only")?.split(",") as ShortKind[] | undefined
  for (const k of only ?? []) {
    if (!SHORT_KINDS.includes(k))
      throw new Error(`unknown kind ${k}; known: ${SHORT_KINDS.join(", ")}`)
  }

  const manifest = JSON.parse(
    await readFile(path.join(from, "manifest.json"), "utf8"),
  ) as Manifest
  const devo = JSON.parse(
    await readFile(path.join(from, "devotional.json"), "utf8"),
  ) as DevotionalText
  const render = JSON.parse(
    await readFile(path.join(from, "render.json"), "utf8"),
  ) as SourcePackRender

  const turn = range("film-turn")
  const refl = range("reflection")
  const overrides: CutdownOverrides = {
    ...(turn ? { filmTurn: { fromSec: turn.a, toSec: turn.b } } : {}),
    ...(refl ? { reflection: { from: refl.a, to: refl.b } } : {}),
  }
  const film = manifest.cards.find((c) => c.kind === "video")
  const wantTurn = !only || only.includes("film-turn")
  if (
    !turn &&
    wantTurn &&
    film?.subtitles &&
    !process.argv.includes("--no-model")
  ) {
    const d = devo as DevotionalText & { title?: string; message?: unknown }
    const llm = createDevotionalLlm({ model: getDevotionalModel() })
    const picked = await chooseFilmTurn(llm, {
      subtitles: film.subtitles,
      title: String(d.title ?? ""),
      log: (msg) => console.log(msg),
      ...(typeof d.message === "string"
        ? { message: d.message }
        : d.message && typeof d.message === "object" && "idea" in d.message
          ? { message: String((d.message as { idea: unknown }).idea) }
          : {}),
    })
    if (picked) {
      console.log(
        `film turn (${llm.model}): ${picked.fromSec.toFixed(1)}-${picked.toSec.toFixed(1)}s, ${picked.why}`,
      )
      overrides.filmTurn = picked
    } else {
      console.log("film turn: the model's pick broke a rule; skipped")
    }
  }
  const plan = planCutdown(manifest, devo, overrides)
  const shorts = plan.shorts.filter((s) => !only || only.includes(s.kind))
  for (const s of plan.skipped) console.log(`skip ${s.kind}: ${s.reason}`)

  await mkdir(outDir, { recursive: true })
  const report: string[] = []
  for (const short of shorts) {
    const stage = await mkdtemp(
      path.join(tmpdir(), `devo-short-${short.kind}-`),
    )
    try {
      const m = buildShortManifest(manifest, short)
      for (const f of collectManifestFiles(m)) {
        const dest = path.join(stage, f)
        if (f === "clip.mp4" && short.film) {
          await trimFilm(
            path.join(from, f),
            dest,
            short.film.fromSec,
            short.film.toSec,
          )
        } else {
          await symlink(path.resolve(from, f), dest)
        }
      }
      const manifestPath = path.join(stage, "manifest.json")
      await writeFile(manifestPath, JSON.stringify(m, null, 2) + "\n")
      const target = stills
        ? path.join(outDir, `${short.kind}.mp4`)
        : await nextFreePath(outDir, `${short.kind}.mp4`)
      console.log(
        `\n▶ ${short.kind} (${short.durationSec.toFixed(1)}s) → ${target}`,
      )
      // The long form's look, minus what belongs to a whole video: no stills
      // or frame range carried over, no draft scale, no music bed.
      const look = { ...render.options }
      for (const k of ["stills", "stillsFrames", "frameRange", "draftScale"]) {
        delete look[k]
      }
      await runRender(
        manifestPath,
        target,
        "devotional",
        render.style,
        render.layout,
        0,
        render.xfadeSec,
        render.videoAudioLevel,
        { ...look, ...(stills ? { stills: 3 } : {}) },
      )
      if (stills) continue
      const q = await qa(target)
      const flags = [
        q.durationSec < 15 || q.durationSec > 46 ? "LENGTH" : "",
        q.lufs == null || Math.abs(q.lufs + 20) > 3 ? "LOUDNESS" : "",
        q.blackSec > 0 ? "BLACK" : "",
      ].filter(Boolean)
      console.log(
        `  ${q.durationSec.toFixed(1)}s, ${q.lufs?.toFixed(1)} LUFS, black ${q.blackSec.toFixed(1)}s ${flags.length ? "⚠️ " + flags.join(" ") : "ok"}`,
      )
      report.push(
        `## ${path.basename(target)}\n\n` +
          `- Kind: ${short.kind}. ${short.why.replace(/\.$/, "")}.\n` +
          `- Length ${q.durationSec.toFixed(1)} s, loudness ${q.lufs?.toFixed(1)} LUFS` +
          `${flags.length ? `, check: ${flags.join(", ")}` : ""}.\n\n` +
          `> ${spokenText(manifest, short)}\n`,
      )
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => {})
    }
  }
  if (report.length > 0) {
    const md = await nextFreePath(outDir, "shorts.md")
    await writeFile(
      md,
      `# Shorts\n\nCut from ${path.basename(from)}. No hook, no call to action: ` +
        `the post caption carries the link to the full devotional.\n\n` +
        report.join("\n") +
        (plan.skipped.length
          ? `\n## Not cut\n\n${plan.skipped.map((s) => `- ${s.kind}: ${s.reason}`).join("\n")}\n`
          : ""),
    )
    console.log(`\nlist → ${md}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
