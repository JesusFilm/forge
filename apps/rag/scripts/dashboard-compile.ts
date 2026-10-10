/**
 * `pnpm dashboard:build` — merge the prod read (dashboard/prod-status-data.json)
 * with the asserted tracker (docs/source-status.yaml) and the registry into
 * dashboard/compiled-data.json, then render dashboard/index.html from
 * dashboard/template.html.
 *
 * No DB and no secrets: it reads three committed/local inputs and writes two
 * outputs. Safe to run in CI or by anyone after a `dashboard:data` refresh.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"
import { allSources } from "../src/registry/index.js"
import {
  sourceStatusFileSchema,
  validateSourceStatusRegistry,
  type CanonicalSourceIdentity,
  type SourceStatusFile,
} from "../src/contracts/source-status.js"
import { buildCompiledData, renderHtml } from "./lib/dashboard/compile.js"
import { validateDashboardSnapshot } from "./dashboard-validate-snapshot.js"
import { assertPublicDashboardSafe } from "./lib/dashboard/public-safety.js"
import { publishDashboardPair } from "./lib/dashboard/publish.js"
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
const COMMIT_MARKER = path.join(
  path.dirname(INDEX_HTML),
  ".dashboard-commit.json",
)

/** Project the rich source-status.yaml into the minimal shape compile needs. */
function projectYaml(doc: SourceStatusFile): YamlSources {
  const out: YamlSources = {}
  for (const [key, src] of Object.entries(doc.sources)) {
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

/** Validate the lifecycle contract and its canonical registry projection. */
export function parseCanonicalLifecycle(
  raw: string,
  registry: readonly CanonicalSourceIdentity[],
): SourceStatusFile {
  const document = parse(raw)
  assertPublicDashboardSafe(document, "source-status")
  const lifecycle = sourceStatusFileSchema.parse(document)
  validateSourceStatusRegistry(lifecycle, registry)
  return lifecycle
}

async function main(): Promise<void> {
  const snapshotRaw = await readFile(PROD_JSON, "utf8")
  validateDashboardSnapshot(snapshotRaw)
  const prod = prodStatusDataSchema.parse(JSON.parse(snapshotRaw))
  const yamlRaw = await readFile(YAML_FILE, "utf8")
  const lifecycle = parseCanonicalLifecycle(yamlRaw, allSources())
  const yaml = projectYaml(lifecycle)
  const sourceMap = sourceMapSchema.parse(
    parse(await readFile(SOURCE_MAP_FILE, "utf8")),
  )
  const registry = projectRegistry()
  const template = await readFile(TEMPLATE, "utf8")
  assertPublicDashboardSafe(
    { prod, yaml, sourceMap, registry },
    "public-inputs",
  )

  // generated_at comes from the prod read (prod.fetched_at), NOT the build clock,
  // so rebuilding the same export reproduces identical output (CodeRabbit #1).
  const compiled = buildCompiledData({
    prod,
    yaml,
    registry,
    sourceMap,
  })
  const html = renderHtml(template, compiled)

  await publishDashboardPair(
    { json: COMPILED_JSON, html: INDEX_HTML, marker: COMMIT_MARKER },
    JSON.stringify(compiled, null, 2) + "\n",
    html,
  )
  console.log(
    `✔ compiled ${compiled.source_rows.length} source row(s) (${compiled.sources.length} source×language cell(s), ${compiled.documented.length} documented) → ${path.relative(process.cwd(), COMPILED_JSON)} + ${path.relative(process.cwd(), INDEX_HTML)}`,
  )
}

if (process.argv[1]?.endsWith("dashboard-compile.ts"))
  main().catch((error: unknown) => {
    console.error(
      `✖ dashboard compilation refused: ${error instanceof Error ? error.message : "validation failed"}`,
    )
    process.exit(1)
  })
