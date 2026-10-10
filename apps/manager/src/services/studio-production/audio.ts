import { StudioProductionError } from "@/services/studio-production/errors"
import { env } from "@/config/env"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
const execute = promisify(execFile)
/** Measure retained bytes, not a model's suggested duration. Decode without trimming. */
export async function measureStudioAudio(bytes: Buffer) {
  if (!bytes.length || bytes.length > 24 * 1024 * 1024)
    throw new StudioProductionError("Audio outside byte bound")
  const directory = await mkdtemp(join(tmpdir(), "studio-narration-")),
    path = join(directory, "audio.mp3")
  try {
    await writeFile(path, bytes)
    const { stdout } = await execute(
      env.STUDIO_FFPROBE_PATH ?? "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        path,
      ],
      { timeout: 15000, maxBuffer: 32768 },
    )
    const info = z
      .object({
        format: z.object({ duration: z.string() }),
        streams: z
          .array(z.object({ codec_type: z.literal("audio") }))
          .min(1)
          .max(1),
      })
      .parse(JSON.parse(stdout))
    const duration = z
      .number()
      .finite()
      .positive()
      .max(3600)
      .parse(Number(info.format.duration))
    await execute(
      env.STUDIO_FFMPEG_PATH ?? "ffmpeg",
      ["-v", "error", "-i", path, "-map", "0:a:0", "-f", "null", "-"],
      { timeout: 30000, maxBuffer: 32768 },
    )
    return Math.ceil(duration * 1000)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
