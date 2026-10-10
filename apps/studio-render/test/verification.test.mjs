import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { executeStudioChild } from "../src/isolation.mjs"
test(
  "fresh credential-free verifier rejects bytes whose claimed dimensions differ",
  { skip: !process.env.STUDIO_CODEC_DIR, timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "studio460-verify-"))
    try {
      const bytes = await readFile(
        "/tmp/forge-studio-460-runtime/text-output.mp4",
      )
      await writeFile(join(dir, "output.mp4"), bytes)
      await writeFile(
        join(dir, "input.json"),
        JSON.stringify({
          digest: createHash("sha256").update(bytes).digest("hex"),
          width: 640,
          height: 180,
          fps: 30,
          durationInFrames: 30,
        }),
      )
      await assert.rejects(
        executeStudioChild({
          nativeDir: resolve("apps/studio-render/dist"),
          child: resolve("apps/studio-render/src/verify.mjs"),
          node: process.execPath,
          input: dir,
          codec: process.env.STUDIO_CODEC_DIR,
          stdoutBytes: 8192,
          timeoutMs: 10000,
        }),
        /does not match|Unexpected output streams/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
