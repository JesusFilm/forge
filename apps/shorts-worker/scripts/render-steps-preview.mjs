import path from "node:path"
import { bundle } from "@remotion/bundler"
import {
  ensureBrowser,
  renderMedia,
  selectComposition,
} from "@remotion/renderer"

const ROOT = "/Users/mac/Forge/.claude/worktrees/devo-lab"
const ENTRY = path.join(
  ROOT,
  "packages/shorts-compositions/src/devotional/entry.ts",
)
const out = process.argv[2]

await ensureBrowser()
const serveUrl = await bundle({ entryPoint: ENTRY, webpackOverride: (c) => c })
const composition = await selectComposition({
  serveUrl,
  id: "devotional-steps-preview",
  inputProps: {},
})
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: out,
  inputProps: {},
  onProgress: ({ progress }) => {
    if (Math.round(progress * 100) % 25 === 0)
      process.stdout.write(`${Math.round(progress * 100)}% `)
  },
})
console.log("\ndone:", out)
