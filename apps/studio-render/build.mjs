import { resolve } from "node:path"
import { build } from "esbuild"
import { bundle } from "@remotion/bundler"
import { createRequire } from "node:module"
import { copyFile } from "node:fs/promises"
const require = createRequire(import.meta.url)
await build({
  entryPoints: ["src/main.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/main.mjs",
})
await bundle({
  entryPoint: require.resolve("@forge/shorts-compositions/studio/entry"),
  outDir: resolve("dist/bundle"),
})
for (const file of ["child.mjs", "verify.mjs"])
  await copyFile("src/" + file, "dist/" + file)
