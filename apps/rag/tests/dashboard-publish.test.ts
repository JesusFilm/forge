import { mkdtemp, mkdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { renderHtml } from "../scripts/lib/dashboard/compile.js"
import {
  assertDashboardPair,
  dashboardCommitMarker,
  publishDashboardPair,
} from "../scripts/lib/dashboard/publish.js"
import { build } from "./dashboard-source-map.fixtures.js"

const TEMPLATE = `<p><!-- DASHBOARD_GENERATED_AT --></p><table><tbody><!-- DASHBOARD_ROWS --></tbody></table><!-- DASHBOARD_UNCLASSIFIED -->`
const content = () => {
  const data = build()
  return {
    json: `${JSON.stringify(data, null, 2)}\n`,
    html: renderHtml(TEMPLATE, data),
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "rag-dashboard-"))
  const paths = {
    json: path.join(root, "compiled.json"),
    html: path.join(root, "site", "index.html"),
    marker: path.join(root, "site", ".dashboard-commit.json"),
  }
  await mkdir(path.dirname(paths.html), { recursive: true })
  return paths
}

describe("dashboard pair publication", () => {
  it("publishes and validates JSON and HTML with a last-written commit marker", async () => {
    const paths = await fixture()
    const next = content()
    await publishDashboardPair(paths, next.json, next.html)
    expect(await readFile(paths.marker, "utf8")).toBe(
      dashboardCommitMarker(next.json, next.html),
    )
    expect(() =>
      assertDashboardPair(
        next.json,
        next.html,
        dashboardCommitMarker(next.json, next.html),
      ),
    ).not.toThrow()
  })

  it("restores the complete prior pair after an interruption", async () => {
    const paths = await fixture()
    const prior = content()
    await publishDashboardPair(paths, prior.json, prior.html)
    const next = { ...prior, html: `${prior.html}\n` }
    await expect(
      publishDashboardPair(paths, next.json, next.html, {
        afterFirstPublish: () => {
          throw new Error("interrupted")
        },
      }),
    ).rejects.toThrow("interrupted")
    expect(await readFile(paths.json, "utf8")).toBe(prior.json)
    expect(await readFile(paths.html, "utf8")).toBe(prior.html)
    expect(await readFile(paths.marker, "utf8")).toBe(
      dashboardCommitMarker(prior.json, prior.html),
    )
  })

  it("refuses a concurrent publisher while the lock exists", async () => {
    const paths = await fixture()
    const next = content()
    await mkdir(`${paths.marker}.lock`)
    await expect(
      publishDashboardPair(paths, next.json, next.html),
    ).rejects.toMatchObject({ code: "EEXIST" })
  })

  it("rejects a mismatched marker", () => {
    const next = content()
    expect(() =>
      assertDashboardPair(
        next.json,
        `${next.html}\n`,
        dashboardCommitMarker(next.json, next.html),
      ),
    ).toThrow(/marker/)
  })
})
