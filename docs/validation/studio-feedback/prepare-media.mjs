import { execFileSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const media = resolve(repo, ".tmp/studio-feedback/media")
await mkdir(media, { recursive: true })
execFileSync(
  process.env.FFMPEG_PATH ?? "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=30",
    "-t",
    "20",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "30",
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    resolve(media, "source.mp4"),
    "-t",
    "20",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "30",
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_list_size",
    "0",
    resolve(media, "source.m3u8"),
  ],
  { stdio: "inherit" },
)
console.log(`Synthetic HLS and export media: ${media}`)
