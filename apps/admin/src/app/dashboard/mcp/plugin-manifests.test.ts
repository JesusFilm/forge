import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * The `/dashboard/mcp` onboarding page tells operators to run
 * `codex plugin marketplace add JesusFilm/forge` AND
 * `/plugin marketplace add JesusFilm/forge`. Each platform discovers the
 * marketplace through its own manifest path, so a plugin added for one
 * platform and forgotten for the other makes half that page a lie — the
 * failure mode that shipped originally (Codex manifests only, Claude tab
 * failing with "Marketplace file not found"). These tests live in admin
 * because admin owns the page making the promise.
 */
const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../..",
)

const codexMarketplace = join(repoRoot, ".agents/plugins/marketplace.json")
const claudeMarketplace = join(repoRoot, ".claude-plugin/marketplace.json")

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

function pluginNames(marketplace: Record<string, unknown>): string[] {
  const plugins = marketplace.plugins as Array<{ name: string }>
  return plugins.map((plugin) => plugin.name).sort()
}

describe("plugin marketplace manifests", () => {
  it("ships a Claude marketplace manifest alongside the Codex one", () => {
    expect(existsSync(codexMarketplace)).toBe(true)
    expect(existsSync(claudeMarketplace)).toBe(true)
  })

  it("offers the same plugins on both platforms", () => {
    expect(pluginNames(readJson(claudeMarketplace))).toEqual(
      pluginNames(readJson(codexMarketplace)),
    )
  })

  it("resolves every Claude plugin source to a matching plugin manifest with skills", () => {
    const plugins = readJson(claudeMarketplace).plugins as Array<{
      name: string
      source: string
    }>

    expect(plugins.length).toBeGreaterThan(0)

    for (const plugin of plugins) {
      const pluginDir = resolve(repoRoot, plugin.source)
      const manifestPath = join(pluginDir, ".claude-plugin/plugin.json")

      expect(existsSync(manifestPath), `${plugin.name}: ${manifestPath}`).toBe(
        true,
      )
      expect(readJson(manifestPath).name).toBe(plugin.name)

      // A plugin with no skills installs cleanly and does nothing.
      const skillsDir = join(pluginDir, "skills")
      expect(existsSync(skillsDir), `${plugin.name}: ${skillsDir}`).toBe(true)
    }
  })
})
