// Actual execution service with local paths; does not qualify the image PID1 launcher.
import { readFile, realpath, mkdir } from "node:fs/promises"
import { resolve, join } from "node:path"
import { createPublicKey } from "node:crypto"
import { createRequire } from "node:module"
import { createExecutionService } from "../../apps/studio-render/src/service.mjs"
const output = process.argv[2]
const config = JSON.parse(await readFile(join(output, "renderer.json"), "utf8"))
const required = createRequire(resolve("apps/studio-render/package.json"))
const dependencies = await realpath("node_modules")
await required("@remotion/bundler").bundle({
  entryPoint: resolve("packages/shorts-compositions/src/studio/entry.tsx"),
  outDir: join(output, "bundle"),
})
await mkdir(join(output, "render-work"), { recursive: true, mode: 0o700 })
const service = await createExecutionService({
  publicKey: createPublicKey(config.publicKey),
  root: join(output, "render-work"),
  paths: {
    nativeDir: resolve("apps/studio-render/dist"),
    node: process.execPath,
    child: resolve("apps/studio-render/src/child.mjs"),
    verifyChild: resolve("apps/studio-render/src/verify.mjs"),
    dependencies,
    renderer: required
      .resolve("@remotion/renderer")
      .replace(dependencies, "/deps"),
    bundle: join(output, "bundle"),
    browser: config.browser,
    codec: config.codec,
  },
})
service.server.listen(55484, "127.0.0.1", () =>
  console.log("Contained local renderer 55484"),
)
