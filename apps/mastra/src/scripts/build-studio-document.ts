/**
 * Build a Shorts Studio document from a `cut-devotional-shorts --studio`
 * export, once its audio is uploaded.
 *
 *   pnpm --filter @forge/mastra exec tsx src/scripts/build-studio-document.ts \
 *     --plan=<dir>/history/studio-plan.json --refs=<refs.json> --out=<document.json>
 *
 * refs.json carries what only the Studio side knows:
 *   {
 *     "title": "...", "language": "english", "runtimeVersion": "...",
 *     "film": <shorts.capture `source`, any trim>,
 *     "narration": {assetId, versionId, digest},
 *     "music": {assetId, versionId, digest},
 *     "components": {filmLook, kineticQuestion, historyCredit, serifLine,
 *                    closeQuestion},              // version ids
 *     "componentRegistrations": [...]             // copied from a project
 *   }
 *
 * The output goes to shorts.create (as `document`) or shorts.apply
 * (`restore-document`).
 */
import { readFile, writeFile } from "node:fs/promises"

import {
  type StudioHistoryPlan,
  historyStudioDocument,
} from "../services/devotional/studio-export"

function arg(name: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!hit) throw new Error(`--${name}=<path> is required`)
  return hit.slice(name.length + 3)
}

async function main() {
  const plan = JSON.parse(
    await readFile(arg("plan"), "utf8"),
  ) as StudioHistoryPlan & { musicVolume?: number }
  const refs = JSON.parse(await readFile(arg("refs"), "utf8"))
  const document = historyStudioDocument({
    title: refs.title,
    language: refs.language,
    runtimeVersion: refs.runtimeVersion,
    plan,
    // Each shot sets its own startMs/endMs over the captured trim.
    film: refs.film,
    components: refs.components,
    componentRegistrations: refs.componentRegistrations,
    narration: refs.narration,
    music: refs.music,
    musicVolume: plan.musicVolume ?? 0.2,
  })
  await writeFile(arg("out"), JSON.stringify(document, null, 2) + "\n")
  console.log(`document → ${arg("out")} (${document.items.length} items)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
