import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"
import { URL } from "node:url"

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
