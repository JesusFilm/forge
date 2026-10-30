import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const read = (path) => readFileSync(resolve(root, path), "utf8")
const manifests = new Map(
  ["apps", "packages"].flatMap((lane) =>
    readdirSync(resolve(root, lane), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const path = `${lane}/${entry.name}`
        try {
          const manifest = JSON.parse(read(`${path}/package.json`))
          return [[manifest.name, { path, manifest }]]
        } catch (error) {
          if (error.code === "ENOENT") return []
          throw error
        }
      }),
  ),
)
const closure = new Map()
function include(name) {
  if (closure.has(name)) return
  const entry = manifests.get(name)
  assert.ok(entry, `Missing workspace manifest ${name}`)
  closure.set(name, entry.path)
  for (const [dependency, version] of Object.entries({
    ...entry.manifest.dependencies,
    ...entry.manifest.devDependencies,
  })) {
    if (version.startsWith("workspace:")) include(dependency)
  }
}
include("@forge/admin")

test("Admin image includes the full transitive workspace closure at install and build", () => {
  const dockerfile = read("apps/admin/Dockerfile")
  const install = dockerfile.indexOf("pnpm install")
  const build = dockerfile.indexOf("pnpm --filter @forge/admin build")
  assert.ok(install > 0 && build > install)
  for (const [name, path] of closure) {
    const manifestCopy = `COPY ${path}/package.json ${path}/package.json`
    const sourceCopy = `COPY ${path} ${path}`
    assert.ok(
      dockerfile.slice(0, install).includes(manifestCopy),
      `${name}: manifest absent before install`,
    )
    assert.ok(
      dockerfile.slice(install, build).includes(sourceCopy),
      `${name}: source absent before build`,
    )
  }
})

test("both image workflow filters cover the dependency closure and web/worker share the image", () => {
  const workflow = read(".github/workflows/admin-security-image.yml")
  const [pullRequest, push] = workflow.split("  push:")
  for (const path of closure.values()) {
    assert.ok(pullRequest.includes(`"${path}/**"`), `PR filter omits ${path}`)
    assert.ok(push.includes(`"${path}/**"`), `push filter omits ${path}`)
  }
  assert.ok(
    workflow.includes(
      "docker build -f apps/admin/Dockerfile -t admin-security-ci .",
    ),
  )
  for (const role of ["web", "worker"]) {
    const path =
      role === "web"
        ? "apps/admin/railway.toml"
        : "apps/admin/railway.worker.toml"
    assert.match(read(path), /dockerfilePath = "apps\/admin\/Dockerfile"/)
    assert.ok(workflow.includes(`predeploy-production.sh ${role}`))
  }
  assert.ok(workflow.includes("verify-production-image.mjs"))
})
