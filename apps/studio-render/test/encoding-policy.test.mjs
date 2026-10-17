import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { spawn, spawnSync } from "node:child_process"
import { once, EventEmitter } from "node:events"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import test from "node:test"
import { clearTimeout, setTimeout } from "node:timers"
import { URL } from "node:url"
import { compileFunction } from "node:vm"
import { deflateSync } from "node:zlib"

const require = createRequire(new URL("../package.json", import.meta.url))
const renderer = require.resolve("@remotion/renderer")
const sdkRequire = createRequire(renderer)
const sdkRoot = path.dirname(renderer)
const { generateFfmpegArgs } = sdkRequire("./ffmpeg-args")
const cap = 134217728
const composition = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 8856,
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// Run the actual child body, replacing only its fixed runtime imports and I/O.
// The policy stays inline in production; the test cannot substitute its formula.
async function childOptions(selected = composition, bytes = 1) {
  const source = (
    await readFile(new URL("../src/child.mjs", import.meta.url), "utf8")
  )
    .replace(/^import .* from .*\n/gm, "")
    .replace('import("/runtime/renderer.cjs")', "loadRenderer()")
  let captured
  let piped = false
  let closed = false
  const server = {
    listen(_port, _host, done) {
      done()
    },
    address: () => ({ port: 12345 }),
    closeAllConnections() {},
    close() {
      closed = true
    },
  }
  await new AsyncFunction(
    "createReadStream",
    "execFileSync",
    "read",
    "stat",
    "createServer",
    "pipeline",
    "resolve",
    "process",
    "loadRenderer",
    source,
  )(
    () => ({}),
    () => assert.fail("Unexpected HLS remux"),
    async () => JSON.stringify({ media: {} }),
    async () => ({ size: bytes }),
    () => server,
    async () => {
      piped = true
    },
    path.resolve,
    { env: {}, stdout: {} },
    async () => ({
      selectComposition: async () => selected,
      renderMedia: async (options) => {
        captured = options
      },
    }),
  )
  assert.equal(closed, true)
  assert.equal(piped, true)
  return captured
}

function codecOptions(options) {
  return {
    ...options,
    ...options.composition,
    pixelFormat: "yuv420p",
    imageFormat: "jpeg",
    proResProfile: null,
    proResProfileName: undefined,
    crf: options.crf ?? null,
    gopSize: null,
    colorSpace: "default",
    hardwareAcceleration: "disable",
    indent: false,
  }
}

async function preencodeArgs(options, outputLocation) {
  const filename = path.join(sdkRoot, "prespawn-ffmpeg.js")
  const module = { exports: {} }
  let captured
  compileFunction(await readFile(filename, "utf8"), [
    "require",
    "module",
    "exports",
  ])(
    (id) =>
      id === "./call-ffmpeg"
        ? {
            callFf({ bin, args }) {
              assert.equal(bin, "ffmpeg")
              captured = args
              const task = new EventEmitter()
              task.stderr = new PassThrough()
              return task
            },
          }
        : sdkRequire(id),
    module,
    module.exports,
  )
  module.exports.prespawnFfmpeg({ ...codecOptions(options), outputLocation })
  assert.ok(captured, "Installed SDK must reach its subprocess boundary")
  return captured.map(String)
}

function value(args, flag) {
  assert.equal(args.filter((arg) => arg === flag).length, 1, flag)
  return args[args.indexOf(flag) + 1]
}

test("actual child budgets the full duration and SDK applies it before final video copy", async () => {
  const options = await childOptions()
  assert.equal(options.composition, composition)
  assert.equal(options.audioCodec, "aac")
  assert.equal(options.audioBitrate, "320k")
  assert.equal(options.sampleRate, 48000)
  assert.equal(options.enforceAudioTrack, true)
  assert.equal(options.concurrency, 1)
  assert.equal(options.offthreadVideoThreads, 1)
  assert.equal(options.offthreadVideoCacheSizeInBytes, 33554432)
  assert.equal(Object.hasOwn(options, "crf"), false)
  const args = await preencodeArgs(options, "/tmp/pre-encode.mp4")
  assert.equal(value(args, "-f"), "image2pipe")
  assert.equal(value(args, "-i"), "-")
  assert.equal(value(args, "-vcodec"), "mjpeg")
  assert.equal(value(args, "-s"), "1080x1920")
  assert.equal(value(args, "-r"), "30")
  assert.equal(value(args, "-c:v"), "libx264")
  assert.equal(value(args, "-preset"), "veryfast")
  assert.equal(value(args, "-b:v"), options.videoBitrate)
  assert.equal(value(args, "-maxrate"), options.encodingMaxRate)
  assert.equal(value(args, "-bufsize"), options.encodingBufferSize)
  assert.equal(args.includes("-crf"), false)
  assert.deepEqual(args.slice(0, 6), [
    "-threads",
    "1",
    "-filter_threads",
    "1",
    "-filter_complex_threads",
    "1",
  ])
  assert.deepEqual(args.slice(-3), ["-threads", "1", "/tmp/pre-encode.mp4"])
  const max = Number.parseInt(options.encodingMaxRate) * 1000
  const buffer = Number.parseInt(options.encodingBufferSize) * 1000
  const target = Number.parseInt(options.videoBitrate) * 1000
  const duration = composition.durationInFrames / composition.fps
  assert.ok(target > 0 && target < max && max <= 25000000)
  assert.ok(target <= 0.9 * max && target + 1000 > 0.9 * max)
  assert.equal(buffer, 2 * max)
  assert.ok(
    max * duration + buffer + 320000 * duration <= (cap - 16 * 1024 * 1024) * 8,
  )
  assert.ok(
    (max + 1000) * (duration + 2) + 320000 * duration >
      (cap - 16 * 1024 * 1024) * 8,
  )
  const copied = generateFfmpegArgs({
    ...codecOptions(options),
    hasPreencoded: true,
  }).flat(2)
  assert.deepEqual(copied, ["-c:v", "copy"])
  const short = await childOptions({ ...composition, durationInFrames: 30 })
  assert.equal(short.encodingMaxRate, "25000k")
  assert.equal(short.videoBitrate, "22500k")
})

test("actual child rejects infeasible/invalid durations and oversized final output", async () => {
  for (const durationInFrames of [0, -1, NaN, Infinity, 1000000000]) {
    await assert.rejects(
      childOptions({ ...composition, durationInFrames }),
      /Duration cannot fit/,
    )
  }
  await assert.rejects(
    childOptions({ ...composition, fps: 0 }),
    /Duration cannot fit/,
  )
  await assert.rejects(
    childOptions(composition, cap + 1),
    /Output size rejected/,
  )
  await assert.rejects(childOptions(composition, 0), /Output size rejected/)
  await childOptions(composition, cap)
})

// Native fixture: independent moving noise frames, without optional lavfi video
// generators. PNG construction uses only Node; the bundled codec makes JPEGs.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0)
  return n >>> 0
})
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  const header = Buffer.alloc(4),
    trailer = Buffer.alloc(4)
  header.writeUInt32BE(data.length)
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([header, bytes, trailer])
}
function noisePng(seed) {
  const { width, height } = composition
  const pixels = Buffer.alloc((width + 1) * height)
  let state = seed
  for (let y = 0; y < height; y++) {
    for (let x = 1; x <= width; x++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      pixels[y * (width + 1) + x] = state & 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // Eight-bit grayscale, no palette or interlacing.
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

test(
  "native moving 1080p encode fits the long-project envelope with complete AAC; default CRF does not",
  {
    timeout: 90000,
    skip: process.platform !== "linux" || process.arch !== "x64",
  },
  async (t) => {
    const codec = path.dirname(
      sdkRequire.resolve("@remotion/compositor-linux-x64-gnu/package.json"),
    )
    const dir = await mkdtemp(path.join(tmpdir(), "studio-encoding-policy-"))
    function run(binary, args, input) {
      const result = spawnSync(
        path.join(codec, binary),
        ["-v", "error", ...args],
        {
          input,
          timeout: 30000,
          maxBuffer: 32 * 1024 * 1024,
        },
      )
      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(result.status, 0, result.stderr.toString())
      return result.stdout
    }
    try {
      const options = await childOptions()
      const frames = [1, 2, 3, 4].map((seed) =>
        run(
          "ffmpeg",
          [
            "-threads",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-i",
            "-",
            "-frames:v",
            "1",
            "-c:v",
            "mjpeg",
            "-q:v",
            "4",
            "-threads",
            "1",
            "-f",
            "image2pipe",
            "-",
          ],
          noisePng(seed),
        ),
      )
      async function encode(policy, name) {
        const output = path.join(dir, name)
        const args = await preencodeArgs(policy, output)
        const child = spawn(
          path.join(codec, "ffmpeg"),
          ["-v", "error", ...args],
          { stdio: ["pipe", "ignore", "pipe"] },
        )
        let errors = ""
        child.stderr.on("data", (bytes) => {
          errors += bytes
        })
        // Attach exit/error handling before writing so an early failure is caught.
        const completed = once(child, "close")
        const timer = setTimeout(() => child.kill("SIGKILL"), 30000)
        try {
          for (let frame = 0; frame < 90; frame++) {
            if (!child.stdin.write(frames[frame % frames.length]))
              await once(child.stdin, "drain")
          }
          child.stdin.end()
          const [code] = await completed
          assert.equal(code, 0, errors)
        } finally {
          clearTimeout(timer)
          child.kill("SIGKILL")
        }
        return output
      }
      const video = await encode(options, "bounded.mp4")
      const copied = generateFfmpegArgs({
        ...codecOptions(options),
        hasPreencoded: true,
      }).flat(2)
      const output = path.join(dir, "complete.mp4")
      run("ffmpeg", [
        "-threads",
        "1",
        "-i",
        video,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=3",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        ...copied,
        "-c:a",
        options.audioCodec,
        "-b:a",
        options.audioBitrate,
        "-ar",
        "48000",
        "-threads",
        "1",
        "-movflags",
        "+faststart",
        output,
      ])
      const { streams } = JSON.parse(
        run("ffprobe", [
          "-count_frames",
          "-show_streams",
          "-of",
          "json",
          output,
        ]).toString(),
      )
      assert.equal(streams.length, 2)
      const v = streams.find((stream) => stream.codec_type === "video")
      const a = streams.find((stream) => stream.codec_type === "audio")
      assert.equal(v.codec_name, "h264")
      assert.equal(v.width, 1080)
      assert.equal(v.height, 1920)
      assert.equal(v.avg_frame_rate, "30/1")
      assert.equal(Number(v.nb_read_frames), 90)
      assert.ok(Math.abs(Number(v.duration) - 3) <= 1 / 30)
      assert.equal(a.codec_name, "aac")
      assert.equal(Number(a.sample_rate), 48000)
      assert.ok([1, 2].includes(a.channels))
      assert.ok(Math.abs(Number(a.duration) - 3) <= 0.1)
      run("ffmpeg", [
        "-xerror",
        "-threads",
        "1",
        "-i",
        output,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c:v",
        "rawvideo",
        "-c:a",
        "pcm_s16le",
        "-threads",
        "1",
        "-f",
        "null",
        "-",
      ])
      const wav = run("ffmpeg", [
        "-i",
        output,
        "-vn",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        "-",
      ])
      assert.equal(wav.toString("ascii", 0, 4), "RIFF")
      assert.equal(wav.toString("ascii", 8, 12), "WAVE")
      let dataOffset = 12
      while (wav.toString("ascii", dataOffset, dataOffset + 4) !== "data") {
        assert.ok(dataOffset + 8 < wav.length, "Decoded WAV must contain PCM")
        const length = wav.readUInt32LE(dataOffset + 4)
        dataOffset += 8 + length + (length % 2)
      }
      const samples = wav.subarray(dataOffset + 8)
      const sampleFrames = samples.length / (2 * a.channels)
      assert.ok(sampleFrames >= 3 * 48000 && sampleFrames <= 3 * 48000 + 1024)
      let energy = 0
      for (let offset = 0; offset < samples.length; offset += 2)
        energy += (samples.readInt16LE(offset) / 32768) ** 2
      assert.ok(
        energy / (samples.length / 2) > 0.0001,
        "Audible source must survive AAC delivery",
      )
      const allowance =
        (Number.parseInt(options.encodingMaxRate) * 1000 * 3 +
          Number.parseInt(options.encodingBufferSize) * 1000 +
          320000 * 3) /
        8
      assert.ok(
        (await stat(output)).size <= allowance,
        "Complete mux must fit the video/VBV/audio envelope",
      )
      const legacy = {
        ...options,
        videoBitrate: null,
        encodingMaxRate: null,
        encodingBufferSize: null,
      }
      // Hold the faster preset fixed: a speed-only fix with default CRF18 must
      // still fail. This measures rate control, not host-dependent preset speed.
      const legacyOutput = await encode(legacy, "legacy-crf18.mp4")
      t.diagnostic(
        `Native complete mux ${(await stat(output)).size}B; allowance ${Math.floor(allowance)}B; legacy video ${(await stat(legacyOutput)).size}B`,
      )
      assert.ok(
        (await stat(legacyOutput)).size > allowance,
        "Fixture must catch the original unbounded CRF18 policy",
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
