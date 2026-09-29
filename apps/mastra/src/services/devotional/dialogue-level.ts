import { spawn } from "node:child_process"

/**
 * Film dialogue and narration at one loudness (owner, 2026-09-29: the
 * narrator came out louder than the people in the film, so she turned the
 * clip up and then down again when the reflection began).
 *
 * The film's level is measured where people SPEAK (its subtitle cues), not
 * across the whole clip: music and effects would otherwise decide the number.
 * The narration is measured across every narrated segment. The clip then plays
 * at the gain that puts its dialogue on the narration's loudness.
 */

/** Integrated loudness (LUFS) of the inputs played back to back, optionally
 *  only inside `windows` (seconds) of a single input. Null when ffmpeg cannot
 *  measure it (silent or unreadable input). */
export function measureLufs(
  files: ReadonlyArray<string>,
  windows?: ReadonlyArray<readonly [number, number]>,
): Promise<number | null> {
  const inputs = files.flatMap((f) => ["-i", f])
  const select =
    windows && windows.length > 0
      ? `aselect='${windows
          .map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`)
          .join("+")}',asetpts=N/SR/TB,`
      : ""
  const graph =
    files.length > 1
      ? `${files.map((_, i) => `[${i}:a]`).join("")}concat=n=${files.length}:v=0:a=1,${select}ebur128`
      : `[0:a]${select}ebur128`
  return new Promise((resolve) => {
    const p = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        ...inputs,
        "-filter_complex",
        graph,
        "-f",
        "null",
        "-",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    let err = ""
    p.stderr.on("data", (d: Buffer) => (err += d.toString()))
    p.on("error", () => resolve(null))
    p.on("close", () => {
      const all = [...err.matchAll(/I:\s+(-?[\d.]+) LUFS/g)]
      const v = all.length ? Number(all[all.length - 1][1]) : NaN
      // ebur128 reports -70 for silence; that is not a level to match.
      resolve(Number.isFinite(v) && v > -60 ? v : null)
    })
  })
}

/** Playback gains are kept inside this range: past it the measurement is
 *  more likely wrong than the mix. */
export const CLIP_LEVEL_MIN = 0.25
export const CLIP_LEVEL_MAX = 2

/** Gain for the clip so its dialogue sits at the narration's loudness. */
export function levelToMatch(dialogueLufs: number, narrationLufs: number) {
  const gain = 10 ** ((narrationLufs - dialogueLufs) / 20)
  return Math.min(CLIP_LEVEL_MAX, Math.max(CLIP_LEVEL_MIN, gain))
}

export async function matchClipDialogueLevel({
  clipFile,
  cues,
  narrationFiles,
}: {
  clipFile: string
  /** Dialogue cues in the clip's own time (seconds). */
  cues: ReadonlyArray<readonly [number, number]>
  narrationFiles: ReadonlyArray<string>
}): Promise<{
  level: number
  dialogueLufs: number
  narrationLufs: number
} | null> {
  if (cues.length === 0 || narrationFiles.length === 0) return null
  const [dialogueLufs, narrationLufs] = await Promise.all([
    measureLufs([clipFile], cues),
    measureLufs(narrationFiles),
  ])
  if (dialogueLufs == null || narrationLufs == null) return null
  return {
    level: levelToMatch(dialogueLufs, narrationLufs),
    dialogueLufs,
    narrationLufs,
  }
}
