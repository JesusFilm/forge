import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { executeStudioChild } from "../src/isolation.mjs"

test(
  "contained Chromium renders trimmed retained HLS, mixed audio, captions and versioned custom code",
  { skip: process.env.STUDIO_RENDER_SMOKE !== "1", timeout: 90000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "studio460-composition-"))
    const codec = process.env.STUDIO_CODEC_DIR
    const ffmpeg = (args) => {
      const result = spawnSync(
        join(codec, "ffmpeg"),
        ["-v", "error", "-nostdin", ...args],
        { timeout: 20000, maxBuffer: 8388608 },
      )
      assert.equal(result.status, 0, result.stderr.toString())
      return result.stdout
    }
    try {
      const { currentCgroupDirectory, verifyExecutionBudget } =
        await import("../src/budget.mjs")
      console.log(
        "effective containment",
        await verifyExecutionBudget(await currentCgroupDirectory()),
      )
      // First second is red, second is blue. The exported timeline must start blue.
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=red:s=320x180:r=30:d=1",
        "-f",
        "lavfi",
        "-i",
        "color=blue:s=320x180:r=30:d=1",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        "-hls_time",
        "1",
        "-hls_playlist_type",
        "vod",
        "-hls_segment_filename",
        join(dir, "segment-%d.ts"),
        join(dir, "source.m3u8"),
      ])
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:sample_rate=48000:duration=2",
        "-c:a",
        "pcm_s16le",
        join(dir, "voice.wav"),
      ])
      const required = createRequire(resolve("apps/shorts-worker/package.json"))
      await required("@remotion/bundler").bundle({
        entryPoint: resolve(
          "packages/shorts-compositions/src/studio/entry.tsx",
        ),
        outDir: join(dir, "bundle"),
      })
      const dependencies = await realpath("node_modules")
      const runtimeVersion =
        "studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16"
      const reference = {
        assetId: "fixture",
        versionId: "fixture-v1",
        digest: "a".repeat(64),
      }
      const source = {
        videoId: "source",
        dubId: "dub",
        editionId: "edition",
        language: "english",
        subtitle: {
          trackId: "subtitles",
          editionId: "edition",
          language: "english",
          asset: reference,
        },
        preview: reference,
        export: reference,
        startMs: 1000,
        endMs: 2000,
      }
      const code =
        "import React from 'react'; import {useCurrentFrame} from 'remotion'; export default function Overlay(){const frame=useCurrentFrame();return <div style={{position:'absolute',left:0,top:0,width:40+frame,height:40,background:'#00ff00'}}/>}"
      const input = {
        document: {
          version: 1,
          title: "Source render",
          language: "english",
          runtimeVersion,
          width: 320,
          height: 180,
          fps: 30,
          durationInFrames: 30,
          tracks: [
            { id: "source", kind: "visual" },
            { id: "overlay", kind: "visual" },
            { id: "captions", kind: "caption" },
            { id: "voice", kind: "audio" },
          ],
          components: [
            {
              versionId: "component-v1",
              code: {
                ...reference,
                digest: createHash("sha256").update(code).digest("hex"),
              },
              runtimeVersion,
              dependencies: [
                { name: "react", version: "19.2.4" },
                { name: "remotion", version: "4.0.475" },
              ],
              width: 320,
              height: 180,
              duration: { minFrames: 1, maxFrames: 90 },
              assets: [],
              controls: {},
            },
          ],
          packRevisionIds: [],
          items: [
            {
              id: "video",
              kind: "video",
              trackId: "source",
              startFrame: 0,
              durationInFrames: 30,
              source,
              volume: 0,
            },
            {
              id: "component",
              kind: "component",
              trackId: "overlay",
              startFrame: 0,
              durationInFrames: 30,
              componentVersionId: "component-v1",
              properties: {},
            },
            {
              id: "caption",
              kind: "text",
              trackId: "captions",
              startFrame: 0,
              durationInFrames: 30,
              text: "Retained caption",
              properties: { fontSize: 18, color: "#ffffff" },
            },
            {
              id: "audio",
              kind: "audio",
              trackId: "voice",
              startFrame: 0,
              durationInFrames: 30,
              asset: reference,
              sourceStartMs: 500,
              volume: 0.5,
            },
          ],
        },
        media: {
          video: { file: "source.m3u8", sourceStartMs: 0, kind: "hls" },
          audio: { file: "voice.wav", sourceStartMs: 0, kind: "audio" },
        },
        code: { "component-v1": code },
      }
      await writeFile(join(dir, "input.json"), JSON.stringify(input))
      const output = await executeStudioChild({
        nativeDir: resolve("apps/studio-render/dist"),
        child: resolve("apps/studio-render/src/child.mjs"),
        node: process.execPath,
        input: dir,
        bundle: join(dir, "bundle"),
        dependencies,
        browser: resolve(
          "apps/shorts-worker/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64",
        ),
        codec,
        renderer: required
          .resolve("@remotion/renderer")
          .replace(dependencies, "/deps"),
        timeoutMs: 60000,
      })
      const file = join(dir, "output.mp4")
      await writeFile(file, output)
      if (process.env.STUDIO_RENDER_ARTIFACT)
        await writeFile(process.env.STUDIO_RENDER_ARTIFACT, output)
      const pixels = ffmpeg([
        "-i",
        file,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ])
      const pixel = (x, y) =>
        Array.from(pixels.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3))
      const blue = pixel(300, 150),
        green = pixel(10, 10)
      assert.ok(
        blue[2] > 200 && blue[0] < 30 && blue[1] < 30,
        `trimmed source is blue: ${blue}`,
      )
      assert.ok(
        green[1] > 200 && green[0] < 30 && green[2] < 30,
        `custom component is green: ${green}`,
      )
      const audio = ffmpeg([
        "-i",
        file,
        "-map",
        "0:a:0",
        "-f",
        "f32le",
        "-ac",
        "1",
        "pipe:1",
      ])
      let energy = 0
      for (let i = 0; i < audio.length; i += 4)
        energy += audio.readFloatLE(i) ** 2
      assert.ok(
        Math.sqrt(energy / (audio.length / 4)) > 0.02,
        "retained voice is audible",
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
