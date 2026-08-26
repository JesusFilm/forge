import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createRequire } from "node:module"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { URL } from "node:url"
import { promisify } from "node:util"

const read = (path) => readFile(new URL(path, import.meta.url), "utf8")
const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const depcruise = new URL(
  "../../../node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
  import.meta.url,
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
  for (const rule of config.forbidden) {
    assert.equal(rule.severity, "error", rule.name)
  }
})

test("rejects representative cross-lane and test-to-adapter imports", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "forge-rag-boundaries-"))
  await Promise.all([
    mkdir(join(fixtureRoot, "src/acquisition"), { recursive: true }),
    mkdir(join(fixtureRoot, "src/adapters"), { recursive: true }),
    mkdir(join(fixtureRoot, "tests"), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(fixtureRoot, "tsconfig.json"), '{"compilerOptions":{}}'),
    writeFile(
      join(fixtureRoot, "src/adapters/db.ts"),
      "export const db = true\n",
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
  ])

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        depcruise.pathname,
        "src",
        "tests",
        "--config",
        new URL("../.dependency-cruiser.cjs", import.meta.url).pathname,
      ],
      { cwd: fixtureRoot },
    ),
    (error) =>
      error.stdout.includes("acquisition-stays-in-lane") &&
      error.stdout.includes("tests-never-touch-adapters"),
  )
})

test("keeps the RAG roadmap out of loaded features and rendered totals", async () => {
  process.env.ROADMAP_DIR = new URL(
    "../../../docs/roadmap",
    import.meta.url,
  ).pathname
  const [{ getAllFeatures }, { renderRoadmapReadme }] = await Promise.all([
    import("../../roadmap/lib/features.ts"),
    import("../../roadmap/lib/markdown.ts"),
  ])
  const features = getAllFeatures()
  assert.equal(
    features.some((feature) => feature.filePath.includes("/rag/")),
    false,
  )
  assert.doesNotMatch(
    renderRoadmapReadme(features),
    /feat-423|RAG Migration Lane/,
  )
  const generatedReadme = await read("../../../docs/roadmap/README.md")
  assert.doesNotMatch(generatedReadme, /feat-423|RAG Migration Lane/)
  for (const sourcePath of [
    "../../roadmap/lib/features.ts",
    "../../roadmap/lib/markdown.ts",
    "../../roadmap/scripts/generate-roadmap-readme.js",
  ]) {
    assert.doesNotMatch(await read(sourcePath), /["']rag["']/)
  }
})
