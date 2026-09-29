#!/usr/bin/env tsx
/**
 * Writes the owner's script sheet (the Vineyard layout) from a cached
 * devotional, without regenerating the text. Adds the montage opening when
 * the cached devotional has a message but no opening lines yet (one small
 * model call); the previous devo.json is kept beside the new one.
 *
 *   pnpm --filter @forge/mastra exec tsx --env-file=.env.local \
 *     src/scripts/format-devotional-script.ts --source=lumo-luke-15 --out=<file>
 */
import { existsSync } from "node:fs"
import { copyFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  cacheDirFor,
  loadCachedDevo,
  saveCachedDevo,
} from "../services/devotional/devotional-cache"
import { EN_LOCALE } from "../services/devotional/devotional-locale"
import { modelFor } from "../services/devotional/devotional-models"
import {
  formatDevotionalScript,
  readSubtitles,
} from "../services/devotional/devotional-script-format"
import { createDevotionalLlm } from "../services/devotional/llm"
import { writeMessageFirstOpening } from "../services/devotional/message-first-ending"
import { videoSource } from "../services/devotional/video-sources"

const arg = (name: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=")

async function main() {
  const src = videoSource(arg("source") ?? "")
  const out = arg("out")
  if (!src || !out)
    throw new Error("--source=<key> and --out=<file> are required")
  const dir = cacheDirFor(src.index, Number(arg("seq") ?? "0"))
  const devo = await loadCachedDevo(dir)
  if (!devo) throw new Error(`no cached devotional in ${dir}`)

  if (!devo.openingLines?.length && devo.message) {
    devo.openingLines = await writeMessageFirstOpening({
      message: {
        ...devo.message,
        classicPoints: devo.message.classicPoints ?? [],
      },
      title: devo.title,
      passageReference: src.passage.reference,
      llm: createDevotionalLlm({ model: modelFor("modernizer") }),
    })
    const cached = path.join(dir, "devo.json")
    if (existsSync(cached))
      await copyFile(cached, path.join(dir, `devo.before-${Date.now()}.json`))
    await saveCachedDevo(dir, devo)
    console.log(`opening: ${devo.openingLines.join(" / ")}`)
  }

  if (existsSync(out))
    throw new Error(`${out} exists; move it to archive/ first`)
  await writeFile(
    out,
    formatDevotionalScript({
      devo,
      source: src,
      subtitles: await readSubtitles(src),
      classicCredit: "J. C. Ryle (Expository Thoughts on Luke, 1858)",
      reflectLeadIn: EN_LOCALE.connectors.steps.reflectAfterClip(),
      prayLeadIn: EN_LOCALE.connectors.steps.pray(),
    }) + "\n",
  )
  console.log(`wrote ${out}`)
}

main().catch((e) => {
  console.error(
    "format-devotional-script failed:",
    e instanceof Error ? e.stack : e,
  )
  process.exit(1)
})
