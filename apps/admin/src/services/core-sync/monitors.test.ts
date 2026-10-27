/**
 * The repo has no other monitor validation for Core Sync, so this suite is
 * the whole guard, modelled on `services/push/monitors.test.ts`.
 *
 * It checks the payload shape the Datadog Monitor API needs, and it checks
 * that every `@event:<name>` token a query names is an `event: "<name>"`
 * string literal that actually exists somewhere in source under
 * `apps/admin/src/`. Core Sync logs structured JSON, so its monitors use the
 * attribute form (`@event:`) rather than the push monitors' quoted
 * `"event=<name>"` substring form — this suite walks the whole source tree
 * instead of a fixed module list so a renamed event literal cannot hide from
 * it behind an unlisted file.
 */
import { readFile, readdir } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const monitorDirectory = new URL(
  "../../../../../infra/datadog-monitors/core-sync/",
  import.meta.url,
)
const sourceRoot = new URL("../../", import.meta.url)

const EXPECTED_FILES = ["run-failed.json", "scheduled-skip-exhausted.json"]

type Monitor = {
  name: string
  type: string
  query: string
  message: string
  tags: string[]
  priority: number
  options: Record<string, unknown>
}

async function readMonitor(file: string): Promise<Monitor> {
  const body = await readFile(new URL(file, monitorDirectory), "utf8")
  return JSON.parse(body) as Monitor
}

async function collectTsFiles(dir: URL): Promise<URL[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: URL[] = []
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const entryUrl = new URL(
      entry.isDirectory() ? `${entry.name}/` : entry.name,
      dir,
    )
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(entryUrl)))
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
    ) {
      // Exclude test files — a test asserting an old literal (e.g. a
      // pinned-shape fixture) would otherwise make a renamed production
      // event look like it's still emitted, defeating the anti-vacuous
      // point of this check.
      files.push(entryUrl)
    }
  }
  return files
}

async function emittedEventLiterals(): Promise<Set<string>> {
  const tokens = new Set<string>()
  const files = await collectTsFiles(sourceRoot)
  for (const file of files) {
    const source = await readFile(file, "utf8")
    for (const match of source.matchAll(/event:\s*"([a-zA-Z0-9_.-]+)"/g)) {
      tokens.add(match[1])
    }
  }
  return tokens
}

describe("the core-sync monitor payloads", () => {
  it("holds exactly the two alerts the ticket asks for", async () => {
    const files = (await readdir(monitorDirectory))
      .filter((file) => file.endsWith(".json"))
      .sort()

    expect(files).toEqual(EXPECTED_FILES)
  })

  it.each(EXPECTED_FILES)("gives %s the shape the API needs", async (file) => {
    const monitor = await readMonitor(file)

    expect(monitor.type).toBe("log alert")
    expect(monitor.name).toMatch(/^\[forge-admin\] Core Sync/)
    expect(typeof monitor.message).toBe("string")
    expect(monitor.message.length).toBeGreaterThan(80)
    expect(typeof monitor.query).toBe("string")
    expect(monitor.query.length).toBeGreaterThan(0)
    expect(monitor.priority).toBeGreaterThanOrEqual(1)
    expect(monitor.priority).toBeLessThanOrEqual(5)
  })

  it.each(EXPECTED_FILES)(
    "scopes %s to the admin service in production",
    async (file) => {
      const monitor = await readMonitor(file)

      expect(monitor.query).toContain("service:forge-admin")
      expect(monitor.query).toContain("env:prod")
      expect(monitor.tags).toContain("service:forge-admin")
      expect(monitor.tags).toContain("env:prod")
      expect(monitor.tags).toContain("feature:core-sync")
    },
  )

  it.each(EXPECTED_FILES)(
    "names in %s only @event tokens that source actually emits",
    async (file) => {
      const monitor = await readMonitor(file)
      const emitted = await emittedEventLiterals()
      const quoted = [
        ...monitor.query.matchAll(/@event:([a-zA-Z0-9_.-]+)/g),
      ].map((match) => match[1])

      expect(quoted.length).toBeGreaterThan(0)
      for (const token of quoted) {
        expect(emitted, `@event:${token} is not emitted anywhere`).toContain(
          token,
        )
      }
    },
  )

  it("covers the run-failed and skip-exhausted signals exactly once", async () => {
    const queries = await Promise.all(
      EXPECTED_FILES.map(async (file) => (await readMonitor(file)).query),
    )
    const joined = queries.join("\n")

    expect(joined).toContain("@event:core-sync.run.failed")
    expect(joined).toContain("@event:core-sync.scheduled.skip-exhausted")
  })
})
