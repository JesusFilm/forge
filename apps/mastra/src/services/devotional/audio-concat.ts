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

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] })
    c.on("error", reject)
    c.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)),
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
): Promise<Uint8Array> {
  const tmp = await mkdtemp(path.join(tmpdir(), "devo-slow-"))
  try {
    const inp = path.join(tmp, "in.mp3")
    await writeFile(inp, bytes)
    const slow = path.join(tmp, "slow.mp3")
    await run("ffmpeg", [
      "-y", "-i", inp, "-filter:a", `atempo=${tempo}`,
      "-c:a", "libmp3lame", "-b:a", "192k", slow,
    ])
    const slowed = new Uint8Array(await readFile(slow))
    // No tail requested → just the slowed audio (used to gently slow a segment
    // like the scripture reading without adding trailing silence).
    if (tailSec <= 0) return slowed
    const sil = path.join(tmp, "sil.mp3")
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-t", String(tailSec), "-c:a", "libmp3lame", "-b:a", "192k", sil,
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
          "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
          "-t", String(gap), "-c:a", "libmp3lame", "-b:a", "192k", s,
        ])
        inputs.push(s)
      }
    }
    const args: string[] = ["-y"]
    inputs.forEach((f) => args.push("-i", f))
    const pre = inputs
      .map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`)
      .join(";")
    const chain = inputs.map((_, i) => `[a${i}]`).join("")
    const out = path.join(tmp, "out.mp3")
    args.push(
      "-filter_complex", `${pre};${chain}concat=n=${inputs.length}:v=0:a=1[out]`,
      "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", out,
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
        "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", String(gapSec), "-c:a", "libmp3lame", "-b:a", "192k", sil,
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
      .map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`)
      .join(";")
    const chain = inputs.map((_, i) => `[a${i}]`).join("")
    const out = path.join(tmp, "out.mp3")
    args.push(
      "-filter_complex", `${pre};${chain}concat=n=${inputs.length}:v=0:a=1[out]`,
      "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", out,
    )
    await run("ffmpeg", args)
    return new Uint8Array(await readFile(out))
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
