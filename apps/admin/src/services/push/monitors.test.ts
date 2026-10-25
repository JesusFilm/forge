/**
 * The repo has no other monitor validation, so this suite is the whole guard.
 *
 * It checks the payload shape the Datadog Monitor API needs, and it checks that
 * every `event=` token a query quotes is a token the push source actually emits.
 * A renamed log event otherwise leaves a monitor silently green for ever.
 */
import { readFile, readdir } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const monitorDirectory = new URL(
  "../../../../../infra/datadog-monitors/push/",
  import.meta.url,
)
const sourceDirectory = new URL("./", import.meta.url)

const EXPECTED_FILES = [
  "dispatch-start-failed.json",
  "heartbeat-stale-live-campaign.json",
  "provider-auth-failed.json",
  "zone-missed.json",
]

/** Every module that may emit a `[push] event=` line the monitors watch. */
const SOURCE_FILES = ["batch.ts", "dispatch.ts", "receipts.ts", "recovery.ts"]

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

async function emittedEventTokens(): Promise<Set<string>> {
  const tokens = new Set<string>()
  for (const file of SOURCE_FILES) {
    const source = await readFile(new URL(file, sourceDirectory), "utf8")
    for (const match of source.matchAll(/event=([a-z_]+)/g)) {
      tokens.add(match[1])
    }
  }
  return tokens
}

async function emittedSource(): Promise<string> {
  const parts = await Promise.all(
    SOURCE_FILES.map((file) =>
      readFile(new URL(file, sourceDirectory), "utf8"),
    ),
  )
  return parts.join("\n")
}

describe("the push monitor payloads", () => {
  it("holds exactly the four alerts the plan asks for", async () => {
    const files = (await readdir(monitorDirectory))
      .filter((file) => file.endsWith(".json"))
      .sort()

    expect(files).toEqual(EXPECTED_FILES)
  })

  it.each(EXPECTED_FILES)("gives %s the shape the API needs", async (file) => {
    const monitor = await readMonitor(file)

    expect(Object.keys(monitor).sort()).toEqual([
      "message",
      "name",
      "options",
      "priority",
      "query",
      "tags",
      "type",
    ])
    expect(monitor.type).toBe("log alert")
    expect(monitor.name).toMatch(/^\[forge-admin\] push /)
    expect(monitor.message.length).toBeGreaterThan(80)
    expect(monitor.priority).toBeGreaterThanOrEqual(1)
    expect(monitor.priority).toBeLessThanOrEqual(5)
    expect(monitor.options).toMatchObject({
      thresholds: { critical: 1 },
      notify_no_data: false,
      evaluation_delay: 60,
      include_tags: true,
    })
  })

  it.each(EXPECTED_FILES)(
    "scopes %s to the admin service in production",
    async (file) => {
      const monitor = await readMonitor(file)

      expect(monitor.query).toContain("service:forge-admin")
      expect(monitor.query).toContain('.rollup("count").last("5m") >= 1')
      expect(monitor.tags).toContain("service:forge-admin")
      expect(monitor.tags).toContain("env:prod")
      expect(monitor.tags).toContain("feature:push-campaigns")
    },
  )

  it.each(EXPECTED_FILES)(
    "names in %s only event tokens the push source emits",
    async (file) => {
      const monitor = await readMonitor(file)
      const emitted = await emittedEventTokens()
      const quoted = [...monitor.query.matchAll(/event=([a-z_]+)/g)].map(
        (match) => match[1],
      )

      expect(quoted.length).toBeGreaterThan(0)
      for (const token of quoted) {
        expect(emitted, `event=${token} is not emitted anywhere`).toContain(
          token,
        )
      }
    },
  )

  it("covers each of the four signals exactly once", async () => {
    const queries = await Promise.all(
      EXPECTED_FILES.map(async (file) => (await readMonitor(file)).query),
    )
    const joined = queries.join("\n")

    expect(joined).toContain("event=provider_auth_failed")
    expect(joined).toContain("event=dispatch_start_failed")
    expect(joined).toContain("event=zone_missed")
    expect(joined).toContain("reason=run_not_alive")
  })

  it("keeps the run_not_alive reason a real value the sweep writes", async () => {
    const source = await emittedSource()

    expect(source).toContain("reason=run_not_alive")
  })

  it("never asks an operator to read the provider's message", async () => {
    for (const file of EXPECTED_FILES) {
      const monitor = await readMonitor(file)
      expect(monitor.message).not.toContain("ExponentPushToken")
      expect(monitor.message.toLowerCase()).not.toContain(
        "provider's message string to",
      )
    }
  })
})
