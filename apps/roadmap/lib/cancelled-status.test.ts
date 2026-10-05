import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"

const roadmapDir = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-status-"))
process.env.ROADMAP_DIR = roadmapDir

after(() => {
  fs.rmSync(roadmapDir, { recursive: true, force: true })
  delete process.env.ROADMAP_DIR
})

function writeFeature(
  id: string,
  status: string,
  dependsOn: string[] = [],
  lane = "platform",
): void {
  const laneDir = path.join(roadmapDir, lane)
  fs.mkdirSync(laneDir, { recursive: true })
  fs.writeFileSync(
    path.join(laneDir, `${id}.md`),
    `---
id: "${id}"
title: "${id} fixture"
owner: "nisal"
priority: "P1"
status: "${status}"
start_date: "2026-09-01"
duration: 1
depends_on: ${JSON.stringify(dependsOn)}
blocks: []
tags: []
---

## Problem

Fixture for ${id}.
`,
  )
}

test("cancelled tickets stay terminal while dependents remain blocked", async () => {
  writeFeature("feat-901", "cancelled", ["feat-999"])
  writeFeature("feat-902", "canceled")
  writeFeature("feat-903", "in-progress", ["feat-902"])
  writeFeature("feat-904", "complete")
  writeFeature("feat-905", "in-progress", ["feat-904"])
  writeFeature("feat-906", "complete", [], "content-discovery")
  writeFeature("feat-906", "cancelled")
  writeFeature("feat-907", "in-progress", ["feat-906"])

  const { getAllFeatures, getStatusCounts } = await import("./features")
  const { renderRoadmapReadme, renderRoadmapMarkdown, renderTicketMarkdown } =
    await import("./markdown")
  const features = getAllFeatures()
  const byId = new Map(features.map((feature) => [feature.id, feature]))

  assert.equal(byId.get("feat-901")?.status, "cancelled")
  assert.equal(byId.get("feat-902")?.status, "cancelled")
  assert.equal(byId.get("feat-903")?.status, "blocked")
  assert.equal(byId.get("feat-905")?.status, "in-progress")
  assert.equal(byId.get("feat-907")?.status, "blocked")
  assert.deepEqual(getStatusCounts(features), {
    "not-started": 0,
    "in-progress": 1,
    complete: 2,
    cancelled: 3,
    blocked: 2,
  })

  const datedFeatures = features.map((feature) => ({
    ...feature,
    start_date: "2026-09-01",
  }))
  const readme = renderRoadmapReadme(
    datedFeatures,
    new Date("2026-10-02T12:00:00"),
  )
  assert.match(readme, /\*\*Cancelled:\*\* 3/)
  assert.match(readme, /\*\*Overdue and open:\*\* 3/)
  assert.match(readme, /feat-901[^\n]*\| cancelled \|/)
  assert.match(renderRoadmapMarkdown(features), /3 cancelled/)
  assert.match(
    renderTicketMarkdown(byId.get("feat-902")!),
    /Status:\*\* cancelled/,
  )
})
