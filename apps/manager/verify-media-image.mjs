import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { promisify } from "node:util"

const execute = promisify(execFile)
const run = (binary, args) =>
  execute(binary, args, {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
    encoding: "buffer",
  })
const bad = [
  "dv-g3b-emudhra.we-have-a-problem.com",
  "dv-g3b-aaa-emudhra.we-have-a-problem.com",
]
const version = await run("ffmpeg", ["-version"])
assert.match(version.stdout.toString(), /ffmpeg version 7\.1\.5/)
for (const host of [...bad, "www.google.com"]) {
  const read = () =>
    run("ffmpeg", [
      "-v",
      "error",
      "-protocol_whitelist",
      "https,tls,tcp,crypto",
      "-f",
      "data",
      "-i",
      `https://${host}/`,
      "-map",
      "0:0",
      "-c",
      "copy",
      "-f",
      "data",
      "pipe:1",
    ])
  if (bad.includes(host))
    await assert.rejects(read(), (e) =>
      /certificate.*verif|verif.*certificate/i.test(e.stderr?.toString() ?? ""),
    )
  else assert.ok((await read()).stdout.length > 0)
}
console.log(
  "PASS: shipped FFmpeg native default rejects both affected chains and reads valid public TLS",
)
const scratch = mkdtempSync("/tmp/manager-media-image-")
let server
try {
  const clip = scratch + "/synthetic.mp4"
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x48:r=10:d=0.3",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    clip,
  ])
  const probe = JSON.parse(
    (
      await run("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        clip,
      ])
    ).stdout,
  )
  assert.ok(
    probe.streams.some(
      (s) => s.codec_type === "video" && s.width === 64 && s.height === 48,
    ),
  )
  assert.ok(probe.streams.some((s) => s.codec_type === "audio"))
  // Exact audioCleanup.ts extraction arguments; no provider or user media.
  const audio = await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    clip,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-f",
    "mp3",
    "pipe:1",
  ])
  assert.ok(audio.stdout.length > 1000)
  console.log(
    "PASS: actual audio-cleanup FFmpeg arguments encode MP3 from local synthetic video; shipped ffprobe reads audio/video",
  )
  const segment = scratch + "/synthetic.ts"
  await run("ffmpeg", [
    "-v",
    "error",
    "-i",
    clip,
    "-c",
    "copy",
    "-f",
    "mpegts",
    segment,
  ])
  server = createServer((request, response) => {
    if (request.url === "/segment.ts") {
      response.end(readFileSync(segment))
      return
    }
    const index = Number(request.url?.match(/^\/bad-(\d)\.m3u8$/)?.[1])
    const target =
      Number.isInteger(index) && bad[index]
        ? `https://${bad[index]}/segment.ts`
        : "/segment.ts"
    response.setHeader("content-type", "application/vnd.apple.mpegurl")
    response.end(
      `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:0.3,\n${target}\n#EXT-X-ENDLIST\n`,
    )
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const origin = `http://127.0.0.1:${server.address().port}`
  const readHls = (path) =>
    run("ffmpeg", [
      "-v",
      "error",
      "-protocol_whitelist",
      "http,https,tls,tcp,crypto",
      "-i",
      origin + path,
      "-f",
      "null",
      "-",
    ])
  for (let i = 0; i < bad.length; i++)
    await assert.rejects(readHls(`/bad-${i}.m3u8`), (e) =>
      /certificate.*verif|verif.*certificate/i.test(e.stderr?.toString() ?? ""),
    )
  await readHls("/good.m3u8")
  console.log(
    "PASS: shipped FFmpeg nested HLS reads reject both affected chains and decode local synthetic media",
  )
} finally {
  if (server) await new Promise((resolve) => server.close(resolve))
  rmSync(scratch, { recursive: true, force: true })
}
