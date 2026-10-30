import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { spawnSync } from "node:child_process"
import { randomInt } from "node:crypto"
import { once } from "node:events"
import fs from "node:fs"
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { URL, URLSearchParams } from "node:url"
import { compileFunction } from "node:vm"
import { deflateSync } from "node:zlib"

const require = createRequire(new URL("../package.json", import.meta.url))
const root = path.dirname(require.resolve("@remotion/renderer"))
const sdk = createRequire(path.join(root, "index.js"))
const paired = {
  FORGE_STUDIO_CODEC_THREADS: "1",
  FORGE_STUDIO_STREAM_FRAMES: "1",
}
const native = process.platform === "linux" && process.arch === "x64"
const { AbortController, fetch } = globalThis

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "studio-local-reuse-"))
  const owned = []
  t.after(async () => {
    for (const file of owned) await rm(file, { force: true, recursive: true })
    await rm(dir, { force: true, recursive: true })
  })
  async function name() {
    // Do not touch another worker/test's generated remux (including index 0).
    const file = `/tmp/studio-source-${randomInt(1000000000000, 2000000000000)}.mp4`
    await writeFile(file, Buffer.from("owned fixture"), { flag: "wx" })
    owned.push(file)
    return file
  }
  async function map() {
    const downloadDir = await mkdtemp(path.join(dir, "downloads-"))
    return {
      downloadDir,
      hasBeenDownloadedMap: {},
      isDownloadingMap: {},
      listeners: {},
      durationOfAssetCache: {},
      downloadListeners: [],
      cleanupController: new AbortController(),
      emitter: new (sdk(
        "./offthread-video-server",
      ).OffthreadVideoServerEmitter)(),
    }
  }
  return { dir, name, map, owned }
}

// Execute the installed modules, replacing only startup environment and optional
// native-analysis/download boundaries. ESM uses its complete asset module body.
async function downloader(format, env = { ...paired }, overrides = {}) {
  const audio = sdk("./assets/get-audio-channels")
  const download = sdk("./assets/download-file")
  if (format === "cjs") {
    const file = path.join(root, "assets/download-and-map-assets-to-file.js")
    const localRequire = createRequire(file)
    const module = { exports: {} }
    compileFunction(await readFile(file, "utf8"), [
      "require",
      "module",
      "exports",
      "process",
    ])(
      (id) => {
        if (id === "./get-audio-channels")
          return { ...audio, ...overrides.audio }
        if (id === "./download-file")
          return { ...download, ...overrides.download }
        if (id === "node:fs") return overrides.fs ?? fs
        return localRequire(id)
      },
      module,
      module.exports,
      { env },
    )
    return module.exports
  }
  const full = await readFile(path.join(root, "esm/index.mjs"), "utf8")
  const marker = "// src/assets/download-and-map-assets-to-file.ts"
  const start = full.indexOf(marker, full.indexOf(marker) + marker.length)
  const end = full.indexOf("// src/assets/download-map.ts", start)
  assert.ok(
    start >= 0 && end > start,
    "Pinned ESM asset module must be identifiable",
  )
  const source = full.slice(start, end)
  // Reuse actual startup declarations if policy is shared across bundled modules.
  const declarations = [
    ...full.matchAll(/^(?:const|var) (forge\w+) = [^\n]+;$/gm),
  ]
    .filter((match) => !source.includes(match[0]))
    .map((match) => match[0])
    .join("\n")
  const dependencies = {
    process: { env },
    fs12: overrides.fs ?? fs,
    path12: path,
    extname2: path.extname,
    random: sdk("remotion/no-react").random,
    ...sdk("./compress-assets"),
    ...sdk("./ensure-output-directory"),
    ...sdk("./mime-types"),
    ...sdk("./assets/sanitize-filepath"),
    ...audio,
    ...overrides.audio,
    ...download,
    ...overrides.download,
  }
  return compileFunction(
    `${declarations}\n${source}\nreturn { downloadAsset, downloadAndMapAssetsToFileUrl, markAllAssetsAsDownloaded }`,
    Object.keys(dependencies),
  )(...Object.values(dependencies))
}

function request(src, downloadMap, extra = {}) {
  return {
    src,
    downloadMap,
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    shouldAnalyzeAudioImmediately: false,
    cancelSignalForAudioAnalysis: undefined,
    audioStreamIndex: undefined,
    ...extra,
  }
}

for (const format of ["cjs", "esm"]) {
  test(`${format}: local remux returns the original inode without download or cache priming`, async (t) => {
    const f = await fixture(t),
      file = await f.name(),
      map = await f.map()
    let probes = 0
    const module = await downloader(
      format,
      { ...paired },
      {
        download: {
          downloadFile: () =>
            assert.fail("Local source must not enter HTTP downloader"),
        },
        audio: {
          getAudioChannelsAndDuration: async (options) => {
            probes++
            assert.equal(options.src, file)
            assert.equal(options.downloadMap, map)
            assert.equal(options.audioStreamIndex, 1)
            assert.equal(options.binariesDirectory, "/native-test-codecs")
          },
        },
      },
    )
    const before = await stat(file)
    const src = `file://${file}`
    assert.equal(await module.downloadAsset(request(src, map)), file)
    assert.equal(probes, 0, "Unrequested audio analysis must not run")
    const asset = {
      type: "video",
      src,
      id: "clip",
      frame: 17,
      volume: 0.5,
      mediaFrame: 41,
      playbackRate: 1.25,
      audioStreamIndex: 1,
    }
    const mapped = await module.downloadAndMapAssetsToFileUrl({
      renderAsset: asset,
      downloadMap: map,
      logLevel: "error",
      indent: false,
      binariesDirectory: "/native-test-codecs",
      shouldAnalyzeAudioImmediately: true,
    })
    assert.deepEqual(mapped, { ...asset, src: file })
    assert.equal(probes, 1)
    module.markAllAssetsAsDownloaded(map)
    assert.equal(await module.downloadAsset(request(src, map)), file)
    assert.deepEqual(await readdir(map.downloadDir), [])
    assert.deepEqual(map.hasBeenDownloadedMap, {})
    const after = await stat(file)
    assert.equal(after.ino, before.ino)
    assert.equal(after.size, before.size)
  })

  test(`${format}: only exact generated paths and paired startup opt-ins permit local reads`, async (t) => {
    const f = await fixture(t),
      file = await f.name()
    for (const env of [
      {},
      { FORGE_STUDIO_CODEC_THREADS: "1" },
      { FORGE_STUDIO_STREAM_FRAMES: "1" },
      { ...paired, FORGE_STUDIO_STREAM_FRAMES: "true" },
    ]) {
      const module = await downloader(format, env)
      await assert.rejects(
        module.downloadAsset(request(`file://${file}`, await f.map())),
      )
    }
    const disabled = {}
    const imported = await downloader(format, disabled)
    Object.assign(disabled, paired)
    await assert.rejects(
      imported.downloadAsset(request(`file://${file}`, await f.map())),
      "Authored code must not activate policy after import",
    )
    const module = await downloader(format)
    const basename = path.basename(file)
    for (const src of [
      file,
      `file://localhost${file}`,
      `file://${file}?x=1`,
      `file://${file}#x`,
      `file:///tmp/../tmp/${basename}`,
      `file:///tmp/%73${basename.slice(1)}`,
      `file:///tmp/studio-source-0${basename.match(/\d+/)[0]}.mp4`,
      "file:///tmp/studio-source--1.mp4",
      "file:///tmp/studio-source-+1.mp4",
      "file:///tmp/studio-source-1.MP4",
      "file:///input/source.mp4",
      "file:///etc/passwd",
      `file://${file}\n`,
      `file://${file}\0`,
    ])
      await assert.rejects(
        module.downloadAsset(request(src, await f.map())),
        src,
      )
    const missing = await f.name()
    await rm(missing)
    await assert.rejects(
      module.downloadAsset(request(`file://${missing}`, await f.map())),
    )
    const link = await f.name()
    await rm(link)
    await symlink(file, link)
    await assert.rejects(
      module.downloadAsset(request(`file://${link}`, await f.map())),
      "Symlinks must fail closed",
    )
    const directory = await f.name()
    await rm(directory)
    await mkdir(directory)
    await assert.rejects(
      module.downloadAsset(request(`file://${directory}`, await f.map())),
      "Directories must fail closed",
    )
  })

  test(`${format}: cancellation prevents local reuse, including cancellation during analysis`, async (t) => {
    const f = await fixture(t),
      file = await f.name(),
      map = await f.map()
    let calls = 0
    const module = await downloader(
      format,
      { ...paired },
      {
        audio: {
          getAudioChannelsAndDuration: async (options) => {
            calls++
            assert.equal(options.cancelSignal, signal)
            map.cleanupController.abort()
          },
        },
      },
    )
    const signal = () => {}
    await assert.rejects(
      module.downloadAsset(
        request(`file://${file}`, map, {
          shouldAnalyzeAudioImmediately: true,
          cancelSignalForAudioAnalysis: signal,
        }),
      ),
      { name: "AbortError" },
    )
    assert.equal(calls, 1)
    await assert.rejects(module.downloadAsset(request(`file://${file}`, map)), {
      name: "AbortError",
    })
    assert.equal(calls, 1)
    const fresh = await f.map()
    const { cancelSignal, cancel } = sdk(
      "./make-cancel-signal",
    ).makeCancelSignal()
    cancel()
    const cancelled = await downloader(
      format,
      { ...paired },
      {
        audio: {
          getAudioChannelsAndDuration: async ({ cancelSignal }) =>
            new Promise((_resolve, reject) => {
              cancelSignal(() => reject(new Error("Native analysis cancelled")))
            }),
        },
      },
    )
    await assert.rejects(
      cancelled.downloadAsset(
        request(`file://${file}`, fresh, {
          shouldAnalyzeAudioImmediately: true,
          cancelSignalForAudioAnalysis: cancelSignal,
        }),
      ),
      { name: "AbortError" },
    )
    assert.deepEqual(await readdir(fresh.downloadDir), [])
    const repeated = await downloader(format),
      repeatedMap = await f.map()
    let subscriptions = 0,
      cancelReuse
    const persistentSignal = (callback) => {
      subscriptions++
      cancelReuse = callback
    }
    for (let frame = 0; frame < 100; frame++) {
      assert.equal(
        await repeated.downloadAsset(
          request(`file://${file}`, repeatedMap, {
            cancelSignalForAudioAnalysis: persistentSignal,
          }),
        ),
        file,
      )
    }
    assert.equal(
      subscriptions,
      1,
      "Frame reuse must not retain one cancellation subscription per frame",
    )
    cancelReuse()
    await assert.rejects(
      repeated.downloadAsset(
        request(`file://${file}`, repeatedMap, {
          cancelSignalForAudioAnalysis: persistentSignal,
        }),
      ),
      { name: "AbortError" },
    )
  })

  test(`${format}: normal HTTP consumers still download unchanged`, async (t) => {
    const f = await fixture(t)
    let transfers = 0
    const server = createServer((_req, res) => {
      transfers++
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": 12 })
      res.end("HTTP fixture")
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    try {
      for (const env of [{}, { ...paired }]) {
        const module = await downloader(format, env),
          map = await f.map()
        const output = await module.downloadAsset(
          request(`http://127.0.0.1:${server.address().port}/source.mp4`, map),
        )
        assert.equal(await readFile(output, "utf8"), "HTTP fixture")
        assert.equal(path.dirname(output), map.downloadDir)
      }
      assert.equal(transfers, 2)
    } finally {
      await new Promise((done) => server.close(done))
    }
  })
}

test("actual child maps only its generated HLS remuxes through the existing mediaUrls seam", async () => {
  const source = (
    await readFile(new URL("../src/child.mjs", import.meta.url), "utf8")
  )
    .replace(/^import .* from .*\n/gm, "")
    .replace('import("/runtime/renderer.cjs")', "loadRenderer()")
  const input = {
    media: {
      first: { kind: "hls", file: "first.m3u8" },
      second: { kind: "hls", file: "second.m3u8" },
      image: { kind: "image", file: "poster.png" },
      audio: { kind: "audio", file: "sound.m4a" },
    },
  }
  const remuxed = []
  let selected, rendered
  const server = {
    listen(_port, _host, done) {
      done()
    },
    address: () => ({ port: 12345 }),
    closeAllConnections() {},
    close() {},
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
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
    (binary, args) => {
      assert.equal(binary, "/codec/ffmpeg")
      assert.deepEqual(
        args.slice(
          args.indexOf("-protocol_whitelist"),
          args.indexOf("-protocol_whitelist") + 2,
        ),
        ["-protocol_whitelist", "file"],
      )
      remuxed.push(args.at(-1))
    },
    async (file) =>
      file === "/input/input.json"
        ? JSON.stringify(input)
        : "#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n",
    async () => ({ size: 1 }),
    () => server,
    async () => {},
    path.resolve,
    { env: {}, stdout: {} },
    async () => ({
      selectComposition: async (options) => {
        selected = options
        return { width: 320, height: 180, fps: 30, durationInFrames: 30 }
      },
      renderMedia: async (options) => {
        rendered = options
      },
    }),
  )
  assert.deepEqual(remuxed, [
    "/tmp/studio-source-0.mp4",
    "/tmp/studio-source-1.mp4",
  ])
  assert.deepEqual(rendered.inputProps.mediaUrls, {
    "studio-source-0.mp4": "file:///tmp/studio-source-0.mp4",
    "studio-source-1.mp4": "file:///tmp/studio-source-1.mp4",
  })
  assert.deepEqual(selected.inputProps.mediaUrls, rendered.inputProps.mediaUrls)
  assert.equal(rendered.inputProps.input.media.image.file, "poster.png")
  assert.equal(rendered.inputProps.input.media.audio.file, "sound.m4a")
  assert.equal(rendered.inputProps.mediaBaseUrl, "http://127.0.0.1:12345/")
})

function png(width, height, frame, rgb) {
  const pixels = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3
      const source = (y * width + x) * 3
      pixels[offset] = rgb ? rgb[source] : (x * 4 + frame * 9) & 255
      pixels[offset + 1] = rgb ? rgb[source + 1] : (y * 5 + frame * 13) & 255
      pixels[offset + 2] = rgb
        ? rgb[source + 2]
        : ((x + y) * 3 + frame * 17) & 255
    }
  function chunk(type, bytes) {
    const content = Buffer.concat([Buffer.from(type), bytes])
    let crc = 0xffffffff
    for (const byte of content) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    const header = Buffer.alloc(4),
      trailer = Buffer.alloc(4)
    header.writeUInt32BE(bytes.length)
    trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([header, content, trailer])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2 // Eight-bit RGB.
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function proxyFrameAsPng(image, width, height) {
  if (
    image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return image
  // This pinned compositor returns uncompressed BMP; its bundled FFmpeg omits
  // the BMP decoder. Decode the bitmap container, then use the real PNG decoder
  // and JPEG encoder. No substitute compositor or HTTP source is involved.
  assert.equal(image.toString("ascii", 0, 2), "BM")
  assert.equal(image.readInt32LE(18), width)
  const storedHeight = image.readInt32LE(22)
  assert.equal(Math.abs(storedHeight), height)
  const bits = image.readUInt16LE(28)
  assert.ok(bits === 24 || bits === 32)
  assert.equal(image.readUInt32LE(30), 0, "Expected uncompressed native bitmap")
  const start = image.readUInt32LE(10),
    stride = Math.ceil((width * bits) / 32) * 4
  const rgb = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from =
        start +
        (storedHeight < 0 ? y : height - 1 - y) * stride +
        x * (bits / 8)
      const to = (y * width + x) * 3
      rgb[to] = image[from + 2]
      rgb[to + 1] = image[from + 1]
      rgb[to + 2] = image[from]
    }
  return png(width, height, 0, rgb)
}

test(
  "native compositor proxy and native audio delivery reuse the remux across cleanup without source HTTP/copies",
  { skip: !native, timeout: 60000 },
  async (t) => {
    const f = await fixture(t),
      file = await f.name()
    const codec = path.dirname(
      sdk.resolve("@remotion/compositor-linux-x64-gnu/package.json"),
    )
    function run(binary, args, input) {
      const result = spawnSync(
        path.join(codec, binary),
        ["-v", "error", ...args],
        { input, timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      )
      assert.equal(
        result.error,
        undefined,
        result.stderr?.toString() || result.error?.message,
      )
      assert.equal(result.status, 0, result.stderr.toString())
      return result.stdout
    }
    // The pinned codec includes PNG/MJPEG but not testsrc/noise. A moving RGB
    // image pipe plus a real sine track gives the compositor real H264/AAC input.
    const width = 64,
      height = 48,
      frames = 30
    const pixels = Buffer.concat(
      Array.from({ length: frames }, (_, frame) => png(width, height, frame)),
    )
    run(
      "ffmpeg",
      [
        "-y",
        "-threads",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "-framerate",
        "30",
        "-i",
        "-",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=1",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-threads",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-movflags",
        "+faststart",
        file,
      ],
      pixels,
    )
    const original = await readFile(file)
    for (const format of ["cjs", "esm"]) {
      const { makeDownloadMap, cleanDownloadMap } = sdk("./assets/download-map")
      const map = makeDownloadMap(48000)
      let sourceTransfers = 0
      const module = await downloader(
        format,
        { ...paired },
        {
          download: {
            downloadFile: () => {
              sourceTransfers++
              assert.fail("Native source must not be copied")
            },
          },
        },
      )
      const filename = path.join(root, "offthread-video-server.js"),
        loaded = { exports: {} }
      compileFunction(await readFile(filename, "utf8"), [
        "require",
        "module",
        "exports",
      ])(
        (id) =>
          id === "./assets/download-and-map-assets-to-file" ? module : sdk(id),
        loaded,
        loaded.exports,
      )
      const proxy = loaded.exports.startOffthreadVideoServer({
        downloadMap: map,
        logLevel: "error",
        indent: false,
        offthreadVideoCacheSizeInBytes: 33554432,
        binariesDirectory: codec,
        offthreadVideoThreads: 1,
      })
      const server = createServer(proxy.listener)
      server.listen(0, "127.0.0.1")
      await once(server, "listening")
      try {
        const src = `file://${file}`
        const imageBuffers = []
        for (const time of [0, 0.5]) {
          const response = await fetch(
            `http://127.0.0.1:${server.address().port}/proxy?${new URLSearchParams({ src, time: String(time), transparent: "true", toneMapped: "true" })}`,
          )
          assert.equal(response.status, 200, await response.clone().text())
          const image = Buffer.from(await response.arrayBuffer())
          const jpeg = run(
            "ffmpeg",
            [
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
              "-threads",
              "1",
              "-f",
              "image2pipe",
              "-",
            ],
            proxyFrameAsPng(image, width, height),
          )
          assert.equal(jpeg.readUInt16BE(0), 0xffd8)
          imageBuffers.push(jpeg)
        }
        assert.notDeepEqual(
          imageBuffers[0],
          imageBuffers[1],
          "Different source times must produce different native frames",
        )
        const analysis = map.durationOfAssetCache[file]
        assert.ok(
          analysis,
          "Proxy must retain requested real native audio analysis",
        )
        assert.ok(analysis.channels > 0)
        assert.ok(Math.abs(analysis.duration - 1) < 0.1)
        module.markAllAssetsAsDownloaded(map)
        const local = await module.downloadAsset(
          request(src, map, {
            shouldAnalyzeAudioImmediately: true,
            binariesDirectory: codec,
          }),
        )
        assert.equal(local, file)
        // Exercise the installed native audio pipeline, not a hand-built AAC mux.
        async function loadModule(relative, dependency, replacement) {
          const filename = path.join(root, relative),
            loaded = { exports: {} },
            localRequire = createRequire(filename)
          compileFunction(await readFile(filename, "utf8"), [
            "require",
            "module",
            "exports",
          ])(
            (id) => (id === dependency ? replacement : localRequire(id)),
            loaded,
            loaded.exports,
          )
          return loaded.exports
        }
        const convert = await loadModule(
          "assets/convert-assets-to-file-urls.js",
          "./download-and-map-assets-to-file",
          module,
        )
        const { createAudio } = await loadModule(
          "create-audio.js",
          "./assets/convert-assets-to-file-urls",
          convert,
        )
        const assets = Array.from({ length: 30 }, (_, frame) => ({
          frame,
          audioAndVideoAssets: [
            {
              type: "video",
              src,
              id: "clip",
              frame,
              mediaFrame: frame,
              volume: 1,
              playbackRate: 1,
              toneFrequency: 1,
              audioStartFrame: 0,
              audioStreamIndex: 0,
            },
          ],
        }))
        const audio = await createAudio({
          assets,
          onDownload: () => {},
          fps: 30,
          logLevel: "error",
          onProgress() {},
          downloadMap: map,
          remotionRoot: f.dir,
          indent: false,
          binariesDirectory: codec,
          audioBitrate: "320k",
          audioCodec: "aac",
          chunkLengthInSeconds: 1,
          trimLeftOffset: 0,
          trimRightOffset: 0,
          forSeamlessAacConcatenation: false,
          sampleRate: 48000,
        })
        assert.ok(audio)
        const decoded = run("ffmpeg", [
          "-i",
          audio,
          "-c:a",
          "pcm_s16le",
          "-f",
          "wav",
          "-",
        ])
        assert.ok(
          decoded.length > 48000 * 2,
          "Complete audio must decode, not just probe",
        )
        const { streams } = JSON.parse(
          run("ffprobe", ["-show_streams", "-of", "json", audio]).toString(),
        )
        assert.equal(streams.length, 1)
        assert.equal(streams[0].codec_name, "aac")
        assert.equal(Number(streams[0].sample_rate), 48000)
        assert.ok(Math.abs(Number(streams[0].duration) - 1) < 0.1)
        let offset = 12
        while (decoded.toString("ascii", offset, offset + 4) !== "data") {
          assert.ok(offset + 8 < decoded.length, "Decoded WAV must contain PCM")
          const length = decoded.readUInt32LE(offset + 4)
          offset += 8 + length + (length % 2)
        }
        const pcm = decoded.subarray(offset + 8)
        let energy = 0
        for (let sample = 0; sample < pcm.length; sample += 2)
          energy += (pcm.readInt16LE(sample) / 32768) ** 2
        assert.ok(
          energy / (pcm.length / 2) > 0.0001,
          "Native audio processing must preserve audible samples",
        )
        const cancelledMap = await f.map()
        const { cancel, cancelSignal } = sdk(
          "./make-cancel-signal",
        ).makeCancelSignal()
        cancel()
        await assert.rejects(
          module.downloadAsset(
            request(src, cancelledMap, {
              binariesDirectory: codec,
              shouldAnalyzeAudioImmediately: true,
              cancelSignalForAudioAnalysis: cancelSignal,
            }),
          ),
          { name: "AbortError" },
        )
        assert.deepEqual(await readdir(map.downloadDir), [])
        assert.equal(sourceTransfers, 0)
      } finally {
        await new Promise((done) => server.close(done))
        await proxy.close()
        cleanDownloadMap(map)
      }
      assert.deepEqual(
        await readFile(file),
        original,
        "SDK cleanup must not delete or modify the original remux",
      )
    }
  },
)
