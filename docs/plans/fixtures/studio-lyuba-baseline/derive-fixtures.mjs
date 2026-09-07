// Offline extraction from recovered source; never invokes generation or rendering.
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { pathToFileURL } from "node:url"
const [root, output] = process.argv.slice(2)
const service = path.join(root, "apps/mastra/src/services/devotional")
const { buildNarrationSegments } = await import(
  pathToFileURL(path.join(service, "devotional-audio.ts"))
)
const { splitReflection } = await import(
  pathToFileURL(path.join(service, "reflection-split.ts"))
)
const { EN_LOCALE } = await import(
  pathToFileURL(path.join(service, "devotional-locale.ts"))
)
const saved = JSON.parse(
  readFileSync(new URL("saved-scripts.json", import.meta.url)),
)
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const cases = saved.map(({ id, sha256, script }) => {
  const options = { suppressOccasion: true }
  const spoken = buildNarrationSegments(script, EN_LOCALE, options)
  const changed = buildNarrationSegments(script, EN_LOCALE, {
    ...options,
    settleLine: "Take a quiet breath.",
  })
  return {
    id,
    sourceSha256: sha256,
    options,
    reflectionCards: splitReflection(script.reflection.text),
    spoken,
    spokenSha256: hash(spoken.map(({ id, text }) => ({ id, text }))),
    changedSettleLine: "Take a quiet breath.",
    changedSpokenSha256: hash(changed.map(({ id, text }) => ({ id, text }))),
  }
})
writeFileSync(
  output,
  JSON.stringify(
    {
      schemaVersion: 1,
      hashEncoding:
        "SHA-256 of UTF-8 JSON.stringify([{id,text}]); ordered, no whitespace/newline; effective speech only, NOT a complete provider cache key",
      cases,
    },
    null,
    2,
  ) + "\n",
)
