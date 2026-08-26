import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath, URL } from "node:url"
import { promisify } from "node:util"

const read = (path) => readFile(new URL(path, import.meta.url), "utf8")
const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const depcruise = new URL(
  "../node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
  import.meta.url,
)
const depcruisePath = fileURLToPath(depcruise)
const depcruiseConfigPath = fileURLToPath(
  new URL("../.dependency-cruiser.cjs", import.meta.url),
)

test("keeps every RAG core lane behind a dependency-cruiser rule", () => {
  const config = require("../.dependency-cruiser.cjs")
  const ruleNames = config.forbidden.map((rule) => rule.name)
  for (const lane of ["acquisition", "indexing", "retrieval", "serving"]) {
    assert.ok(ruleNames.includes(`${lane}-stays-in-lane`))
  }
  assert.ok(ruleNames.includes("contracts-are-pure"))
  assert.ok(ruleNames.includes("adapters-import-only-contracts"))
  assert.ok(ruleNames.includes("only-main-is-the-composition-root"))
  assert.ok(ruleNames.includes("unclassified-modules-cannot-wire-internals"))
  assert.ok(ruleNames.includes("tests-never-touch-adapters"))
  assert.ok(ruleNames.includes("rag-does-not-import-other-apps"))
  assert.ok(ruleNames.includes("not-to-unresolvable"))
  assert.ok(ruleNames.includes("no-circular"))
  for (const rule of config.forbidden) {
    assert.equal(rule.severity, "error", rule.name)
  }
})

test("rejects every governed dependency boundary", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "forge-rag-boundaries-"))
  await Promise.all([
    mkdir(join(fixtureRoot, "src/acquisition"), { recursive: true }),
    mkdir(join(fixtureRoot, "src/adapters"), { recursive: true }),
    mkdir(join(fixtureRoot, "src/contracts"), { recursive: true }),
    mkdir(join(fixtureRoot, "src/retrieval"), { recursive: true }),
    mkdir(join(fixtureRoot, "tests"), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(fixtureRoot, "tsconfig.json"), '{"compilerOptions":{}}'),
    writeFile(
      join(fixtureRoot, "src/adapters/db.ts"),
      'import "../shared.js"\nexport const db = true\n',
    ),
    writeFile(
      join(fixtureRoot, "src/shared.ts"),
      "export const shared = true\n",
    ),
    writeFile(
      join(fixtureRoot, "src/acquisition/acquire.ts"),
      'import "../shared.js"\nexport const acquire = true\n',
    ),
    writeFile(
      join(fixtureRoot, "tests/adapter.test.mjs"),
      'import "../src/adapters/db.js"\n',
    ),
    writeFile(
      join(fixtureRoot, "src/retrieval/unresolved.ts"),
      'import "./missing.js"\n',
    ),
  ])

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [depcruisePath, "src", "tests", "--config", depcruiseConfigPath],
      { cwd: fixtureRoot },
    ),
    (error) =>
      error.stdout.includes("acquisition-stays-in-lane") &&
      error.stdout.includes("tests-never-touch-adapters") &&
      error.stdout.includes("adapters-import-only-contracts") &&
      error.stdout.includes("not-to-unresolvable"),
  )
})

test("rejects imports from another application context", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "forge-rag-app-boundary-"))
  const ragRoot = join(fixtureRoot, "apps/rag")
  await Promise.all([
    mkdir(join(ragRoot, "src/serving"), { recursive: true }),
    mkdir(join(fixtureRoot, "apps/admin/src"), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(ragRoot, "tsconfig.json"), '{"compilerOptions":{}}'),
    writeFile(
      join(fixtureRoot, "apps/admin/src/private.ts"),
      "export const privateValue = true\n",
    ),
    writeFile(
      join(ragRoot, "src/serving/cross-app.ts"),
      'import "../../../admin/src/private.js"\n',
    ),
  ])

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [depcruisePath, "src", "--config", depcruiseConfigPath],
      { cwd: ragRoot },
    ),
    (error) => error.stdout.includes("rag-does-not-import-other-apps"),
  )
})

test("allows core lanes to import contracts", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "forge-rag-allowed-"))
  await Promise.all([
    mkdir(join(fixtureRoot, "src/contracts"), { recursive: true }),
    mkdir(join(fixtureRoot, "src/retrieval"), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(fixtureRoot, "tsconfig.json"), '{"compilerOptions":{}}'),
    writeFile(
      join(fixtureRoot, "src/contracts/index.ts"),
      "export const contract = true\n",
    ),
    writeFile(
      join(fixtureRoot, "src/retrieval/retrieve.ts"),
      'import { contract } from "../contracts/index.js"\nexport { contract }\n',
    ),
  ])

  await execFileAsync(
    process.execPath,
    [depcruisePath, "src", "--config", depcruiseConfigPath],
    { cwd: fixtureRoot },
  )
})

test("keeps the RAG roadmap out of loaded features and rendered totals", async () => {
  process.env.ROADMAP_DIR = fileURLToPath(
    new URL("../../../docs/roadmap", import.meta.url),
  )
  const [{ getAllFeatures }, { renderRoadmapReadme }] = await Promise.all([
    import("../../roadmap/lib/features.ts"),
    import("../../roadmap/lib/markdown.ts"),
  ])
  const features = getAllFeatures()
  assert.ok(features.length > 0)
  assert.equal(
    features.some((feature) => feature.filePath.includes("/rag/")),
    false,
  )
  assert.doesNotMatch(
    renderRoadmapReadme(features),
    /rag\/feat-423|RAG Migration Lane/,
  )
  const generatedReadme = await read("../../../docs/roadmap/README.md")
  assert.doesNotMatch(generatedReadme, /rag\/feat-423|RAG Migration Lane/)
  for (const sourcePath of [
    "../../roadmap/lib/features.ts",
    "../../roadmap/lib/markdown.ts",
    "../../roadmap/scripts/generate-roadmap-readme.js",
  ]) {
    assert.doesNotMatch(await read(sourcePath), /["']rag["']/)
  }
})
