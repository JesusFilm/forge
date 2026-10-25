class StudioVerificationError extends Error {}
import { readFile, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
const expected = JSON.parse(await readFile("/input/input.json", "utf8"))
const path = "/input/output.mp4"
if ((await stat(path)).size > 134217728)
  throw new StudioVerificationError("Output exceeds verifier bound")
const digest = createHash("sha256")
  .update(await readFile(path))
  .digest("hex")
if (digest !== expected.digest)
  throw new StudioVerificationError("Output digest mismatch")
const raw = execFileSync(
  "/codec/ffprobe",
  [
    "-v",
    "error",
    "-count_frames",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration,sample_rate,channels",
    "-of",
    "json",
    path,
  ],
  { encoding: "utf8", timeout: 60000, maxBuffer: 65536 },
)
const streams = JSON.parse(raw).streams
const video = streams.filter((s) => s.codec_type === "video"),
  audio = streams.filter((s) => s.codec_type === "audio")
if (video.length !== 1 || audio.length !== 1 || streams.length !== 2)
  throw new StudioVerificationError("Unexpected output streams")
const v = video[0],
  a = audio[0],
  fps = v.avg_frame_rate.split("/").map(Number)
if (
  v.codec_name !== "h264" ||
  v.width !== expected.width ||
  v.height !== expected.height ||
  Number(v.nb_read_frames) !== expected.durationInFrames ||
  fps[0] / fps[1] !== expected.fps ||
  Math.abs(Number(v.duration) - expected.durationInFrames / expected.fps) >
    1 / expected.fps
)
  throw new StudioVerificationError(
    "Output video does not match admitted composition",
  )
if (
  a.codec_name !== "aac" ||
  Number(a.sample_rate) !== 48000 ||
  ![1, 2].includes(a.channels) ||
  !Number.isFinite(Number(a.duration)) ||
  Math.abs(Number(a.duration) - expected.durationInFrames / expected.fps) > 0.1
)
  throw new StudioVerificationError(
    "Output audio does not match delivery format",
  )
execFileSync(
  "/codec/ffmpeg",
  [
    "-v",
    "error",
    "-xerror",
    "-nostdin",
    "-i",
    path,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-f",
    "null",
    "-",
  ],
  { timeout: 60000, maxBuffer: 65536 },
)
process.stdout.write(
  JSON.stringify({
    version: 1,
    verifierVersion: "studio-codec-1/ffmpeg-n9.0.1-27-g9b0578816c-20260907",
    outputDigest: digest,
    video: {
      codec: "h264",
      width: v.width,
      height: v.height,
      fps: fps[0] / fps[1],
      frames: Number(v.nb_read_frames),
      durationMs: Number(v.duration) * 1000,
    },
    audio: {
      codec: "aac",
      sampleRate: 48000,
      channels: a.channels,
      durationMs: Number(a.duration) * 1000,
    },
    decoded: true,
  }),
)
