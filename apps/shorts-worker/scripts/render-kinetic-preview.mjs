// Review-only: stills of the opening's kinetic captions, one per layout and
// line. Usage: node render-kinetic-preview.mjs <outDir>
import path from "node:path"
import { bundle } from "@remotion/bundler"
import {
  ensureBrowser,
  renderStill,
  selectComposition,
} from "@remotion/renderer"

const ROOT = "/Users/mac/Forge/.claude/worktrees/devo-lab"
const ENTRY = path.join(
  ROOT,
  "packages/shorts-compositions/src/devotional/entry.ts",
)
const outDir = process.argv[2]
const LINES = [
  {
    bg: "kinetic-preview-1.jpg",
    line: "A faithful son stands outside his father's party.",
    hero: "outside",
    accents: ["faithful"],
    side: "left",
  },
  {
    bg: "kinetic-preview-2.jpg",
    line: "His brother squandered it all and wears the best robe.",
    hero: "the best robe",
    accents: ["squandered"],
    side: "right",
  },
]
await ensureBrowser()
const serveUrl = await bundle({
  entryPoint: ENTRY,
  publicDir: path.join(ROOT, "packages/shorts-compositions/public"),
  webpackOverride: (c) => c,
})
for (const layout of ["stack", "staircase", "split"]) {
  for (const [i, l] of LINES.entries()) {
    const inputProps = { ...l, layout }
    const composition = await selectComposition({
      serveUrl,
      id: "devotional-kinetic-preview",
      inputProps,
    })
    const output = path.join(outDir, `${layout}-${i + 1}.png`)
    await renderStill({ composition, serveUrl, output, frame: 140, inputProps })
    console.log(output)
  }
}
