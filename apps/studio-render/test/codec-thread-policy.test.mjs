import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

const require = createRequire(new URL("../package.json", import.meta.url))
const renderer = require.resolve("@remotion/renderer")
const codec = path.join(path.dirname(renderer), "call-ffmpeg.js")

test("pinned renderer CJS and ESM entry points both load", () => {
  execFileSync(process.execPath, ["-e", `require(${JSON.stringify(renderer)})`])
  execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `await import(${JSON.stringify(path.join(path.dirname(renderer), "esm/index.mjs"))})`,
  ])
})

test("contained codec policy bounds every decoder and encoder without changing other consumers or probes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "studio-codec-policy-"))
  try {
    for (const binary of ["ffmpeg", "ffprobe"]) {
      await writeFile(
        path.join(directory, binary),
        `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n`,
        { mode: 0o700 },
      )
    }
    const invoke = (method, bin, args, enabled) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "-e",
            `
      const {${method}} = require(${JSON.stringify(codec)});
      const task = ${method}({bin:${JSON.stringify(bin)}, args:${JSON.stringify(args)}, binariesDirectory:${JSON.stringify(directory)}, indent:false, logLevel:'error'});
      ${method === "callFf" ? "task.then(result => process.stdout.write(result.stdout))" : "task.stdout.pipe(process.stdout)"};
    `,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              FORGE_STUDIO_CODEC_THREADS: enabled ? "1" : "0",
            },
          },
        ),
      )
    const input = [
      "-threads",
      "8",
      "-i",
      "voice.wav",
      "-i",
      "music.wav",
      "-filter_complex_threads",
      "8",
      "-filter_complex",
      "amix=inputs=2",
      "mixed.wav",
    ]
    const bounded = [
      "-filter_threads",
      "1",
      "-filter_complex_threads",
      "1",
      "-threads",
      "1",
      "-i",
      "voice.wav",
      "-threads",
      "1",
      "-i",
      "music.wav",
      "-filter_complex",
      "amix=inputs=2",
      "-threads",
      "1",
      "mixed.wav",
    ]
    for (const method of ["callFf", "callFfNative"]) {
      assert.deepEqual(invoke(method, "ffmpeg", input, true), bounded)
      assert.deepEqual(invoke(method, "ffmpeg", input, false), input)
      assert.deepEqual(invoke(method, "ffprobe", input, true), input)
      assert.deepEqual(invoke(method, "ffmpeg", ["-version"], true), [
        "-version",
      ])
      assert.deepEqual(invoke(method, "ffmpeg", ["-formats"], true), [
        "-formats",
      ])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
