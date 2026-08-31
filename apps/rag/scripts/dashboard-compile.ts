/**
 * `pnpm dashboard:build` — merge the prod read (dashboard/prod-status-data.json)
 * with the asserted tracker (docs/source-status.yaml) and the registry into
 * dashboard/compiled-data.json, then render dashboard/index.html from
 * dashboard/template.html.
 *
 * No DB and no secrets: it reads three committed/local inputs and writes two
 * outputs. Safe to run in CI or by anyone after a `dashboard:data` refresh.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"
import { allSources } from "../src/registry/index.js"
import { buildCompiledData, renderHtml } from "./lib/dashboard/compile.js"
import { validateDashboardSnapshot } from "./dashboard-validate-snapshot.js"
import {
  prodStatusDataSchema,
  sourceMapSchema,
  type RegistrySource,
  type YamlSources,
} from "./lib/dashboard/types.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const PROD_JSON = path.join(ROOT, "dashboard", "prod-status-data.json")
const YAML_FILE = path.join(ROOT, "docs", "source-status.yaml")
const SOURCE_MAP_FILE = path.join(ROOT, "docs", "source-map.yaml")
const TEMPLATE = path.join(ROOT, "dashboard", "template.html")
const COMPILED_JSON = path.join(ROOT, "dashboard", "compiled-data.json")
const INDEX_HTML = path.join(
  ROOT,
  "dashboard",
  "site",
  "rag-status",
  "index.html",
)

/** Project the rich source-status.yaml into the minimal shape compile needs. */
function projectYaml(raw: string): YamlSources {
  const doc = parse(raw) as {
    sources?: Record<
      string,
      {
        name: string
        status: string
        languages: Record<
          string,
          { status: string; stages: { evaluate: string } }
        >
      }
    >
  }
  const out: YamlSources = {}
  for (const [key, src] of Object.entries(doc.sources ?? {})) {
    const languages: YamlSources[string]["languages"] = {}
    for (const [lang, entry] of Object.entries(src.languages)) {
      languages[lang] = {
        evaluateGreen: entry.stages.evaluate === "green",
        status: entry.status,
        // Human blocker/note text is deliberately excluded from the public projection.
        note: null,
      }
    }
    out[key] = { name: src.name, status: src.status, languages }
  }
  return out
}

function projectRegistry(): RegistrySource[] {
  return allSources().map((s) => ({
    key: s.key,
    name: s.name,
    domain: s.domain,
    languages: [...s.languages],
  }))
}

async function main(): Promise<void> {
  const snapshotRaw = await readFile(PROD_JSON, "utf8")
  validateDashboardSnapshot(snapshotRaw)
  const prod = prodStatusDataSchema.parse(JSON.parse(snapshotRaw))
  const yaml = projectYaml(await readFile(YAML_FILE, "utf8"))
  const sourceMap = sourceMapSchema.parse(
    parse(await readFile(SOURCE_MAP_FILE, "utf8")),
  )
  const registry = projectRegistry()
  const template = await readFile(TEMPLATE, "utf8")

  // generated_at comes from the prod read (prod.fetched_at), NOT the build clock,
  // so rebuilding the same export reproduces identical output (CodeRabbit #1).
  const compiled = buildCompiledData({
    prod,
    yaml,
    registry,
    sourceMap,
  })
  const html = renderHtml(template, compiled)

  await mkdir(path.dirname(INDEX_HTML), { recursive: true })
  await writeFile(
    COMPILED_JSON,
    JSON.stringify(compiled, null, 2) + "\n",
    "utf8",
  )
  await writeFile(INDEX_HTML, html, "utf8")
  console.log(
    `✔ compiled ${compiled.source_rows.length} source row(s) (${compiled.sources.length} source×language cell(s), ${compiled.documented.length} documented) → ${path.relative(process.cwd(), COMPILED_JSON)} + ${path.relative(process.cwd(), INDEX_HTML)}`,
  )
}

main().catch((error: unknown) => {
  console.error(
    `✖ dashboard compilation refused: ${error instanceof Error ? error.message : "validation failed"}`,
  )
  process.exit(1)
})
