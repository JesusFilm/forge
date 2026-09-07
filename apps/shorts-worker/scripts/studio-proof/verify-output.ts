import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { sha256 } from "../../src/studio-proof/broker.js"

export async function verifyOutput(ffmpeg: string, path: string) {
  const progress = execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      path,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-progress",
      "pipe:1",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", timeout: 15_000, maxBuffer: 65_536 },
  )
  const frames = Number([...progress.matchAll(/^frame=(\d+)$/gm)].at(-1)?.[1])
  const durationMs =
    Number([...progress.matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1]) / 1000
  assert.equal(frames, 60, "Actual encoded MP4 must decode all 60 video frames")
  assert(
    Math.abs(durationMs - 2000) < 100,
    "Actual encoded audio/video duration must match trim",
  )
  const bytes = await readFile(path)
  return { frames, durationMs, bytes: bytes.length, digest: sha256(bytes) }
}
