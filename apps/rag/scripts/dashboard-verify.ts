/**
 * `pnpm dashboard:verify` — the merge gate. Reads the COMMITTED
 * dashboard/index.html and dashboard/compiled-data.json and fails (non-zero)
 * unless it is byte-identical to rendering the committed template with the
 * committed compiled data.
 *
 * No DB, no secrets, no rebuild: it checks the two committed artifacts agree, so
 * a hand-edited or stale index.html cannot reach production. The Pages workflow
 * runs this on pull requests; see .github/workflows/rag-pages.yml.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { compiledDataSchema } from "./lib/dashboard/types.js"
import { assertHtmlMatchesTemplate } from "./lib/dashboard/compile.js"
import { assertDashboardPair } from "./lib/dashboard/publish.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const COMPILED_JSON = path.join(ROOT, "dashboard", "compiled-data.json")
const TEMPLATE_HTML = path.join(ROOT, "dashboard", "template.html")
const INDEX_HTML = path.join(
  ROOT,
  "dashboard",
  "site",
  "rag-status",
  "index.html",
)
const COMMIT_MARKER = path.join(
  path.dirname(INDEX_HTML),
  ".dashboard-commit.json",
)

async function main(): Promise<void> {
  const [raw, html, marker, template] = await Promise.all([
    readFile(COMPILED_JSON, "utf8"),
    readFile(INDEX_HTML, "utf8"),
    readFile(COMMIT_MARKER, "utf8"),
    readFile(TEMPLATE_HTML, "utf8"),
  ])
  assertDashboardPair(raw, html, marker)
  const data = compiledDataSchema.parse(JSON.parse(raw))

  const misses = assertHtmlMatchesTemplate(template, html, data)
  if (misses.length > 0) {
    console.error(
      `✖ dashboard/index.html is out of sync with compiled-data.json (${misses.length} miss(es)) — run \`pnpm dashboard:build\` and commit:`,
    )
    for (const m of misses) console.error(`   - ${m}`)
    process.exit(1)
  }
  console.log(
    `✔ dashboard/index.html exactly matches the committed template and ${data.source_rows.length} source row(s), ${data.documented.length} documented row(s), ${data.unclassified.length} unclassified row(s)`,
  )
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
