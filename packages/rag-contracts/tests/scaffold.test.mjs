import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath, URL } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const depcruisePath = fileURLToPath(
  new URL(
    "../node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
    import.meta.url,
  ),
)
const depcruiseConfigPath = fileURLToPath(
  new URL("../.dependency-cruiser.cjs", import.meta.url),
)

test("does not depend on application packages", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  )
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }
  const appDirectories = (
    await readdir(new URL("../../../apps", import.meta.url), {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const appPackageNames = await Promise.all(
    appDirectories.map(async (directory) => {
      try {
        const manifest = JSON.parse(
          await readFile(
            new URL(`../../../apps/${directory}/package.json`, import.meta.url),
            "utf8",
          ),
        )
        return manifest.name
      } catch (error) {
        if (error.code === "ENOENT") return null
        throw error
      }
    }),
  )
  for (const appPackageName of appPackageNames.filter(Boolean)) {
    assert.equal(dependencies[appPackageName], undefined, appPackageName)
  }
})

test("rejects relative source imports from an application", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "forge-rag-contracts-"))
  await Promise.all([
    mkdir(join(fixtureRoot, "packages/rag-contracts/src"), { recursive: true }),
    mkdir(join(fixtureRoot, "apps/rag/src"), { recursive: true }),
  ])
  await Promise.all([
    writeFile(
      join(fixtureRoot, "packages/rag-contracts/tsconfig.json"),
      '{"compilerOptions":{}}',
    ),
    writeFile(
      join(fixtureRoot, "apps/rag/src/private.ts"),
      "export const privateValue = true\n",
    ),
    writeFile(
      join(fixtureRoot, "packages/rag-contracts/src/index.ts"),
      'import "../../../apps/rag/src/private.js"\n',
    ),
  ])

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [depcruisePath, "src", "--config", depcruiseConfigPath],
      { cwd: join(fixtureRoot, "packages/rag-contracts") },
    ),
    (error) => error.stdout.includes("contracts-do-not-import-apps"),
  )
})
