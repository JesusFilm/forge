/**
 * Render a Vox-style explainer short from a staged folder (manifest.json with
 * `shortFact.explainer` + the audio and footage it names) through the
 * `devotional-short` composition (VoxExplainer.tsx). Zero TTS: the narration
 * clips are files already in the folder.
 *
 *   pnpm exec tsx src/scripts/render-explainer.ts --stage=<dir> --out=<mp4>
 */
import path from "node:path"

import { runRender } from "../services/devotional/devotional-render"

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const stage = arg("stage")
const out = arg("out")
if (!stage || !out) {
  console.error("usage: render-explainer.ts --stage=<dir> --out=<mp4>")
  process.exit(1)
}
await runRender(
  path.join(stage, "manifest.json"),
  out,
  "devotional-short",
  "clean",
  "grounded",
  // The explainer sets its own bed level; the render script's is unused.
  0.2,
  0,
  0,
  { textFont: "serif" },
)
console.log(`done: ${out}`)
