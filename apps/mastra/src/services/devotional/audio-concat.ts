/**
 * Join MP3 chunk buffers into ONE buffer with a short silence between each —
 * real silence, not an ElevenLabs `<break>` tag (which makes the voice draw out
 * the word before it). Used to place small pauses INSIDE a narration segment
 * (e.g. between the cover date, the lead-in, and the hook) without any prosody
 * artifact. ffmpeg-based; runs wherever audio is assembled (has ffmpeg already).
 */
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * Watchdog for every ffmpeg spawn here. These run dozens of times per render
 * (one per inter-sentence gap, plus the concat itself), so a single wedged
 * process hangs the whole devotional — and the unattended daily job would hang
 * forever with no output. `devotional-render.ts`'s runFfmpeg has had this from
 * the start; these calls did not, which was the gap.
 *
 * Generous relative to the work: joins are a few seconds of 44.1k audio, so a
 * minute means something is genuinely stuck, not merely slow.
 */
const FFMPEG_TIMEOUT_MS = 60_000

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] })
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      c.kill("SIGKILL")
      finish(() =>
        reject(new Error(`${cmd} timed out after ${FFMPEG_TIMEOUT_MS}ms`)),
      )
    }, FFMPEG_TIMEOUT_MS)
    c.on("error", (e) => finish(() => reject(e)))
    c.on("close", (code) =>
      finish(() =>
        code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)),
      ),
    )
  })
}

/**
 * Concatenate `chunks` (MP3 bytes) into one MP3, inserting `gapSec` of silence
 * between adjacent chunks (none before the first or after the last). A single
 * chunk is returned unchanged. Normalizes to 44.1k stereo so the concat is clean.
 */
/**
 * Slow an MP3 slightly (pitch-preserved `atempo`) and append a tail of silence.
 * Used on the CLOSING segment so the final line does not feel rushed and does
 * not end abruptly (owner). `tempo` < 1 slows down; `tailSec` is trailing quiet.
 */
export async function slowAndPad(
  bytes: Uint8Array,
  tempo: number,
  tailSec: number,
  /** Silence prepended BEFORE the audio. Used by the step cards, whose
   *  transition animation must land before the voice names the step. */
  leadSec = 0,
): Promise<Uint8Array> {
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-slow-"))
  try {
    const inp = path.join(tmp, "in.mp3")
    await writeFile(inp, bytes)
    const slow = path.join(tmp, "slow.mp3")
    await run("ffmpeg", [
      "-y",
      "-i",
      inp,
      "-filter:a",
      `atempo=${tempo}`,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      slow,
    ])
    let slowed: Uint8Array = new Uint8Array(await readFile(slow))
    if (leadSec > 0) {
      const lead = path.join(tmp, "lead.mp3")
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        String(leadSec),
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        lead,
      ])
      slowed = new Uint8Array(
        await joinAudioWithGaps(
          [new Uint8Array(await readFile(lead)), slowed],
          0,
        ),
      )
    }
    // No tail requested → just the (optionally lead-padded) audio. Used to
    // gently slow a segment like the scripture reading without trailing
    // silence.
    if (tailSec <= 0) return slowed
    const sil = path.join(tmp, "sil.mp3")
    await run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-t",
      String(tailSec),
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      sil,
    ])
    return joinAudioWithGaps([slowed, new Uint8Array(await readFile(sil))], 0)
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Like `joinAudioWithGaps` but with a PER-GAP duration: `gapsAfter[i]` is the
 * silence inserted after chunk i (the last entry is ignored). Lets us put a
 * short breath between sentences and a longer one between sections — real
 * silence, no `<break>` artifacts.
 */
export async function joinAudioVarGaps(
  chunks: Uint8Array[],
  gapsAfter: number[],
): Promise<Uint8Array> {
  if (chunks.length <= 1) return chunks[0] ?? new Uint8Array()
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-vjoin-"))
  try {
    const inputs: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const f = path.join(tmp, `c${i}.mp3`)
      await writeFile(f, chunks[i])
      inputs.push(f)
      const gap = gapsAfter[i] ?? 0
      if (i < chunks.length - 1 && gap > 0) {
        const s = path.join(tmp, `s${i}.mp3`)
        await run("ffmpeg", [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=44100:cl=stereo",
          "-t",
          String(gap),
          "-c:a",
          "libmp3lame",
          "-b:a",
          "192k",
          s,
        ])
        inputs.push(s)
      }
    }
    const args: string[] = ["-y"]
    inputs.forEach((f) => args.push("-i", f))
    const pre = inputs
      .map(
        (_, i) =>
          `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`,
      )
      .join(";")
    const chain = inputs.map((_, i) => `[a${i}]`).join("")
    const out = path.join(tmp, "out.mp3")
    args.push(
      "-filter_complex",
      `${pre};${chain}concat=n=${inputs.length}:v=0:a=1[out]`,
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      out,
    )
    await run("ffmpeg", args)
    return new Uint8Array(await readFile(out))
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

export async function joinAudioWithGaps(
  chunks: Uint8Array[],
  gapSec: number,
): Promise<Uint8Array> {
  if (chunks.length <= 1) return chunks[0] ?? new Uint8Array()
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-join-"))
  try {
    const files: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const f = path.join(tmp, `c${i}.mp3`)
      await writeFile(f, chunks[i])
      files.push(f)
    }
    let sil: string | null = null
    if (gapSec > 0) {
      sil = path.join(tmp, "sil.mp3")
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        String(gapSec),
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        sil,
      ])
    }
    const inputs: string[] = []
    files.forEach((f, i) => {
      inputs.push(f)
      if (sil && i < files.length - 1) inputs.push(sil)
    })
    const args: string[] = ["-y"]
    inputs.forEach((f) => args.push("-i", f))
    const pre = inputs
      .map(
        (_, i) =>
          `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`,
      )
      .join(";")
    const chain = inputs.map((_, i) => `[a${i}]`).join("")
    const out = path.join(tmp, "out.mp3")
    args.push(
      "-filter_complex",
      `${pre};${chain}concat=n=${inputs.length}:v=0:a=1[out]`,
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      out,
    )
    await run("ffmpeg", args)
    return new Uint8Array(await readFile(out))
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Cut [fromSec, toSec) out of an MP3 (sample-accurate: decoded and trimmed,
 * then re-encoded). Used to split one continuous Eleven v4 read back into the
 * per-card segments the render times its cards by.
 */
export async function sliceAudio(
  bytes: Uint8Array,
  fromSec: number,
  toSec: number,
): Promise<Uint8Array> {
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-slice-"))
  try {
    const inp = path.join(tmp, "in.mp3")
    const out = path.join(tmp, "out.mp3")
    await writeFile(inp, bytes)
    await run("ffmpeg", [
      "-y",
      "-i",
      inp,
      "-af",
      `atrim=start=${Math.max(0, fromSec).toFixed(3)}:end=${toSec.toFixed(3)},asetpts=PTS-STARTPTS`,
      "-ar",
      "44100",
      "-ac",
      "2",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      out,
    ])
    return new Uint8Array(await readFile(out))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/**
 * Bring one take to a fixed loudness (EBU R128, single pass). Used to join
 * lines read by two different voices into one segment: the Russian female
 * voice comes out ~12 dB under the male one, and the render's per-voice
 * levelling works per SEGMENT, so a mixed segment has to arrive level.
 */
export async function normalizeLoudness(
  bytes: Uint8Array,
  lufs = -23.5,
): Promise<Uint8Array> {
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-norm-"))
  try {
    const inp = path.join(tmp, "in.mp3")
    const out = path.join(tmp, "out.mp3")
    await writeFile(inp, bytes)
    await run("ffmpeg", [
      "-y",
      "-i",
      inp,
      "-af",
      `loudnorm=I=${lufs}:TP=-1.5:LRA=11`,
      "-ar",
      "44100",
      "-ac",
      "2",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      out,
    ])
    return new Uint8Array(await readFile(out))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** The real length of an MP3 (ffprobe), for joins that must place word times
 *  exactly: a computed length drifted ~0.2 s a line on the two-voice opening
 *  (2026-10-07), because a cut past the take's last sample is simply shorter. */
export async function audioDurationSec(bytes: Uint8Array): Promise<number> {
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-dur-"))
  try {
    const inp = path.join(tmp, "in.mp3")
    await writeFile(inp, bytes)
    const out = await new Promise<string>((resolve, reject) => {
      const c = spawn("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        inp,
      ])
      let s = ""
      c.stdout.on("data", (d) => (s += String(d)))
      c.on("error", reject)
      c.on("close", (code) =>
        code === 0 ? resolve(s) : reject(new Error(`ffprobe exit ${code}`)),
      )
    })
    const n = Number(out.trim())
    if (!Number.isFinite(n)) throw new Error(`no duration: ${out}`)
    return n
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
