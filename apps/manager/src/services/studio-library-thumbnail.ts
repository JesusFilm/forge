import { execFile } from "node:child_process"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { env } from "@/config/env"

const execute = promisify(execFile)
class StudioThumbnailError extends Error {}

/** Decode local, verified bytes only. Downscale before collecting sample frames. */
export async function videoLibraryThumbnail(
  bytes: Buffer,
  signal?: AbortSignal,
) {
  const directory = await mkdtemp(join(tmpdir(), "studio-library-thumbnail-"))
  try {
    const input = join(directory, "video.bin")
    await writeFile(input, bytes)
    const { stdout, stderr } = await execute(
      env.STUDIO_FFMPEG_PATH ?? "ffmpeg",
      [
        "-v",
        "info",
        "-nostdin",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-protocol_whitelist",
        "file",
        "-i",
        input,
        "-an",
        "-sn",
        "-dn",
        "-vf",
        "scale=320:180:force_original_aspect_ratio=decrease,thumbnail=30",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "pipe:1",
      ],
      { encoding: "buffer", timeout: 12000, maxBuffer: 512 * 1024, signal },
    )
    if (!stdout.length)
      throw new StudioThumbnailError("No video frame available")
    const duration = stderr
      .toString()
      .match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    const durationMs = duration
      ? Math.round(
          (Number(duration[1]) * 3600 +
            Number(duration[2]) * 60 +
            Number(duration[3])) *
            1000,
        )
      : undefined
    return { bytes: stdout, durationMs }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
