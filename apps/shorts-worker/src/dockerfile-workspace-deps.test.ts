import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const dockerfile = readFileSync(
  new URL("../Dockerfile", import.meta.url),
  "utf8",
)
const railwayConfig = readFileSync(
  new URL("../railway.toml", import.meta.url),
  "utf8",
)
const { dependencies = {} } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { dependencies?: Record<string, string> }

const workspacePackages = Object.entries(dependencies)
  .filter(([, version]) => version.startsWith("workspace:"))
  .map(([packageName]) => {
    const forgeScope = "@forge/"
    if (!packageName.startsWith(forgeScope)) {
      throw new Error(`Unsupported workspace dependency: ${packageName}`)
    }
    return packageName.slice(forgeScope.length)
  })

describe("shorts-worker Docker workspace dependencies", () => {
  it.each(workspacePackages)(
    "materializes packages/%s for install, build, runtime, and deploy watching",
    (workspacePackage) => {
      const packageRoot = `packages/${workspacePackage}`

      expect(
        dockerfile.match(
          new RegExp(
            `COPY ${packageRoot}/package\\.json ${packageRoot}/package\\.json`,
            "g",
          ),
        ),
      ).toHaveLength(2)
      expect(dockerfile).toContain(`COPY ${packageRoot} ${packageRoot}`)
      expect(dockerfile).toContain(
        `COPY --from=prod-deps /app/${packageRoot}/node_modules /app/${packageRoot}/node_modules`,
      )
      expect(dockerfile).toContain(`COPY ${packageRoot} /app/${packageRoot}`)
      expect(railwayConfig).toContain(`"/${packageRoot}/**"`)
    },
  )
})
