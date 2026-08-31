/**
 * `pnpm dashboard:verify` — the merge gate. Reads the COMMITTED
 * dashboard/index.html and dashboard/compiled-data.json and fails (non-zero)
 * unless every compiled row's data is actually present in the rendered HTML.
 *
 * No DB, no secrets, no rebuild: it checks the two committed artifacts agree, so
 * a hand-edited or stale index.html cannot reach production. CI runs this on
 * pull requests; see .github/workflows/ci.yml.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { compiledDataSchema } from "./lib/dashboard/types.js"
import { assertHtmlContainsData } from "./lib/dashboard/compile.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const COMPILED_JSON = path.join(ROOT, "dashboard", "compiled-data.json")
const INDEX_HTML = path.join(
  ROOT,
  "dashboard",
  "site",
  "rag-status",
  "index.html",
)

async function main(): Promise<void> {
  const data = compiledDataSchema.parse(
    JSON.parse(await readFile(COMPILED_JSON, "utf8")),
  )
  const html = await readFile(INDEX_HTML, "utf8")

  const misses = assertHtmlContainsData(html, data)
  if (misses.length > 0) {
    console.error(
      `✖ dashboard/index.html is out of sync with compiled-data.json (${misses.length} miss(es)) — run \`pnpm dashboard:build\` and commit:`,
    )
    for (const m of misses) console.error(`   - ${m}`)
    process.exit(1)
  }
  console.log(
    `✔ dashboard/index.html contains all ${data.source_rows.length} source row(s), ${data.documented.length} documented row(s), ${data.unclassified.length} unclassified row(s)`,
  )
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
