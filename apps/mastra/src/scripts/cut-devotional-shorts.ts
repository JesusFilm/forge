/**
 * Cut a finished devotional into vertical shorts (feat-573).
 *
 *   pnpm --filter @forge/mastra exec tsx src/scripts/cut-devotional-shorts.ts \
 *     --from="<video>.source" --out="$HOME/Desktop/Social Media/Prodigal/shorts" \
 *     [--only=language,history] [--stills] \
 *     [--film-turn=139.1-172.6] [--reflection=0-1] [--no-model]
 *     [--film-open="Is this worth celebrating?"] [--film-close="..."]
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
  readdir,
  readFile,
  rename,
  rm,
  stat,
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
import { videoSourceForIndex } from "../services/devotional/video-sources"
import {
  DEFAULT_SHORT_KINDS,
  SHORT_KINDS,
  SHORT_OUTRO_SEC,
  CARD_TAIL_SEC,
  buildShortManifest,
  chooseFilmTurn,
  chooseKineticRoles,
  introTeaserArgs,
  kineticLines,
  openingLinesOf,
  shortComposition,
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
  /** Seconds put in front: played from `preroll` when given (live footage
   *  from a quiet moment of the scene), else the first frame held. */
  leadSec = 0,
  preroll?: { fromSec: number; toSec: number },
) {
  const enc = [
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
  ]
  if (preroll) {
    // Two live pieces of the same clip, joined: the quiet moment, then the
    // window. Accurate seeks on one input.
    const f = (n: number) => n.toFixed(3)
    await run("ffmpeg", [
      "-y",
      "-i",
      src,
      "-filter_complex",
      `[0:v]trim=start=${f(preroll.fromSec)}:end=${f(preroll.toSec)},setpts=PTS-STARTPTS[v0];` +
        `[0:a]atrim=start=${f(preroll.fromSec)}:end=${f(preroll.toSec)},asetpts=PTS-STARTPTS[a0];` +
        `[0:v]trim=start=${f(fromSec)}:end=${f(toSec)},setpts=PTS-STARTPTS[v1];` +
        `[0:a]atrim=start=${f(fromSec)}:end=${f(toSec)},asetpts=PTS-STARTPTS[a1];` +
        `[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      ...enc,
      dest,
    ])
    return
  }
  const lead = leadSec > 0.01
  await run("ffmpeg", [
    "-y",
    "-ss",
    fromSec.toFixed(3),
    "-i",
    src,
    "-t",
    (toSec - fromSec).toFixed(3),
    ...(lead
      ? [
          "-vf",
          `tpad=start_duration=${leadSec.toFixed(3)}:start_mode=clone`,
          "-af",
          `adelay=${Math.round(leadSec * 1000)}:all=1`,
        ]
      : []),
    ...enc,
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

/**
 * The vertical intro teaser: the long form's own opening (shots, voice,
 * kinetic captions) set in 9:16 with the calm CTA, through the approved
 * `render-one-devotional.ts --teaser-intro` path. Shots and framing come from
 * the pack's `render.json` (`intro`), or `--intro-shots` / `--intro-focus`
 * for a pack made before that was recorded; the music bed from
 * `--intro-music`, else the pack's, else the long form's bed. Runs with no
 * ElevenLabs key unless `--allow-tts`: the opening is already recorded.
 */
async function cutIntroTeaser(input: {
  from: string
  outDir: string
  manifest: Manifest
  devo: DevotionalText
  render: SourcePackRender
}): Promise<string | null> {
  const d = input.devo as DevotionalText & {
    clip?: { index?: number }
    sequence?: number
    openingLines?: unknown
  }
  const film = input.manifest.cards.find((c) => c.kind === "video")
  const source =
    d.clip?.index != null ? videoSourceForIndex(d.clip.index) : undefined
  const lines = openingLinesOf(d, film)
  const shotsArg = arg("intro-shots")?.split(",").map(Number)
  const shots = shotsArg ?? input.render.intro?.shots
  if (!source || !lines.length || !shots?.length) {
    console.log(
      `skip intro: ${!source ? "unknown film source" : !lines.length ? "no opening lines" : "no intro shots (pass --intro-shots)"}`,
    )
    return null
  }
  const focus =
    arg("intro-focus")?.split(",").map(Number) ?? input.render.intro?.focus
  const packMusic = path.join(input.from, "music.mp3")
  const music =
    arg("intro-music") ??
    input.render.intro?.musicFile ??
    ((await stat(packMusic).catch(() => null)) ? packMusic : undefined)
  const kinetic = (input.render.intro?.kinetic ??
    (film?.introKinetic as never)) as
    | { line: number; hero: string; accents: string[]; side: string }[]
    | undefined
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-intro-"))
  try {
    const args = introTeaserArgs({
      sourceKey: source.key,
      sequence: d.sequence ?? 0,
      lines,
      shots,
      ...(focus ? { focus } : {}),
      ...(kinetic ? { kinetic } : {}),
      ...(input.render.intro?.hookGapSec != null
        ? { hookGapSec: input.render.intro.hookGapSec }
        : {}),
      ...(music ? { musicFile: music } : {}),
      outDir: tmp,
    })
    console.log(`\n▶ intro → render-one-devotional.ts --teaser-intro`)
    await new Promise<void>((resolve, reject) => {
      const c = spawn(
        "pnpm",
        [
          "exec",
          "tsx",
          "--env-file=.env.local",
          "src/scripts/render-one-devotional.ts",
          ...args,
        ],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            ...(process.argv.includes("--allow-tts")
              ? {}
              : { ELEVENLABS_API_KEY: "" }),
          },
        },
      )
      c.on("error", reject)
      c.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`teaser render exited ${code}`)),
      )
    })
    const mp4 = (await readdir(tmp)).find((f) => f.endsWith(".mp4"))
    if (!mp4) throw new Error("teaser render produced no MP4")
    const target = await nextFreePath(input.outDir, "intro.mp4")
    await rename(path.join(tmp, mp4), target)
    const q = await qa(target)
    console.log(
      `  ${q.durationSec.toFixed(1)}s, ${q.lufs?.toFixed(1)} LUFS, black ${q.blackSec.toFixed(1)}s`,
    )
    return (
      `## ${path.basename(target)}\n\n` +
      `- Kind: intro. The long form's opening in 9:16, ending on the calm call to action.\n` +
      `- Length ${q.durationSec.toFixed(1)} s, loudness ${q.lufs?.toFixed(1)} LUFS.\n\n` +
      `> ${[...lines, "Watch the full devotional on our YouTube channel."].join(" ")}\n`
    )
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

async function main() {
  const from = arg("from")
  const outDir = arg("out")
  if (!from || !outDir)
    throw new Error("--from=<video>.source and --out=<dir> are required")
  // `--frames=30,120` renders exactly those frames as stills.
  const stills = process.argv.includes("--stills") || Boolean(arg("frames"))
  const only = (arg("only")?.split(",") ?? [
    ...DEFAULT_SHORT_KINDS,
  ]) as ShortKind[]
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
    // Silent question cards on the film-verse short.
    ...(arg("film-open") || arg("film-close")
      ? {
          filmVerseCards: {
            ...(arg("film-open") ? { open: arg("film-open")! } : {}),
            ...(arg("film-close") ? { close: arg("film-close")! } : {}),
            ...(arg("film-close-sub")
              ? { closeSub: arg("film-close-sub")! }
              : {}),
          },
        }
      : {}),
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
  if (only.includes("intro")) {
    const done = await cutIntroTeaser({ from, outDir, manifest, devo, render })
    if (done) report.push(done)
  }
  for (const short of shorts) {
    const stage = await mkdtemp(
      path.join(tmpdir(), `devo-short-${short.kind}-`),
    )
    try {
      const m = buildShortManifest(manifest, short)
      if (short.kind === "history" && m.shortFact) {
        // Teaser-style kinetic captions: the model picks each line's hero and
        // accents (the owner's hand picks on the Prodigal teaser are the
        // model), checked in code; --no-model uses the fallback rule.
        const lines = kineticLines(m.cards)
        const llm = process.argv.includes("--no-model")
          ? null
          : createDevotionalLlm({ model: getDevotionalModel() })
        const roles = await chooseKineticRoles(llm, lines, (msg) =>
          console.log(msg),
        )
        for (const r of roles) {
          const text = lines.find((l) => l.from === r.from)?.text
          console.log(
            `  line "${text}" hero="${r.hero}" accents=${JSON.stringify(r.accents)}`,
          )
        }
        ;(m.shortFact as { lines?: unknown }).lines = roles
      }
      for (const f of collectManifestFiles(m)) {
        const dest = path.join(stage, f)
        if (f === "clip.mp4" && short.film) {
          await trimFilm(
            path.join(from, f),
            dest,
            short.film.fromSec,
            // Footage to the very last frame: the outro and the card's own
            // breath after it (a short clip froze for its last 0.8s).
            short.film.toSec + SHORT_OUTRO_SEC + CARD_TAIL_SEC + 0.2,
            short.film.leadSec ?? 0,
            short.film.preroll,
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
        shortComposition(m),
        render.style,
        render.layout,
        0,
        render.xfadeSec,
        render.videoAudioLevel,
        {
          ...look,
          ...(arg("frames")
            ? { stillsFrames: arg("frames") }
            : stills
              ? { stills: 3 }
              : {}),
        },
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
