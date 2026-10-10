import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { executeStudioChild } from "../src/isolation.mjs"
const enabled = process.env.STUDIO_RENDER_SMOKE === "1"
test(
  "real isolated Chromium exports the canonical text composition and verified frames",
  { skip: !enabled, timeout: 90000 },
  async () => {
    if (process.env.STUDIO_CGROUP_CHECK === "1") {
      const { currentCgroupDirectory, verifyExecutionBudget } =
        await import("../src/budget.mjs")
      console.log(
        "effective containment",
        await verifyExecutionBudget(await currentCgroupDirectory()),
      )
    }
    const dir = await mkdtemp(join(tmpdir(), "studio460-render-"))
    try {
      const required = createRequire(resolve("apps/shorts-worker/package.json"))
      const { bundle } = required("@remotion/bundler")
      await bundle({
        entryPoint: resolve(
          "packages/shorts-compositions/src/studio/entry.tsx",
        ),
        outDir: join(dir, "bundle"),
      })
      const deps = await realpath("node_modules")
      const renderer = required
        .resolve("@remotion/renderer")
        .replace(deps, "/deps")
      const input = {
        document: {
          version: 1,
          title: "Render proof",
          language: "english",
          runtimeVersion:
            "studio-proof-1/remotion-4.0.475/react-19.2.4/sucrase-3.35.1/hls-1.6.16",
          width: 320,
          height: 180,
          fps: 30,
          durationInFrames: 30,
          tracks: [{ id: "visual", kind: "visual" }],
          components: [],
          packRevisionIds: [],
          items: [
            {
              id: "text",
              kind: "text",
              trackId: "visual",
              startFrame: 0,
              durationInFrames: 30,
              text: "Retained",
              properties: { fontSize: 32, color: "#ffffff" },
            },
          ],
        },
        media: {},
        code: {},
      }
      await writeFile(join(dir, "input.json"), JSON.stringify(input))
      const output = await executeStudioChild({
        nativeDir: resolve("apps/studio-render/dist"),
        child: resolve("apps/studio-render/src/child.mjs"),
        node: process.execPath,
        input: dir,
        bundle: join(dir, "bundle"),
        dependencies: deps,
        browser: resolve(
          "apps/shorts-worker/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64",
        ),
        codec: process.env.STUDIO_CODEC_DIR,
        timeoutMs: 60000,
        renderer,
      })
      await writeFile(join(dir, "output.mp4"), output)
      if (process.env.STUDIO_RENDER_ARTIFACT)
        await writeFile(process.env.STUDIO_RENDER_ARTIFACT, output)
      const probe = spawnSync(
        join(process.env.STUDIO_CODEC_DIR, "ffprobe"),
        [
          "-v",
          "error",
          "-count_frames",
          "-show_streams",
          "-of",
          "json",
          join(dir, "output.mp4"),
        ],
        { encoding: "utf8", timeout: 10000 },
      )
      assert.equal(probe.status, 0, probe.stderr)
      const video = JSON.parse(probe.stdout).streams.find(
        (s) => s.codec_type === "video",
      )
      assert.equal(video.codec_name, "h264")
      assert.equal(video.width, 320)
      assert.equal(video.height, 180)
      assert.equal(video.nb_read_frames, "30")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
