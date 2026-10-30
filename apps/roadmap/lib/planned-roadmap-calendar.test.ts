import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const appRoot = new URL("../", import.meta.url)
const moduleUrl = new URL("plannedRoadmap.ts", import.meta.url).href
const componentUrl = new URL("components/PlannedRoadmapTimeline.tsx", appRoot)
  .href

function renderInTimezone(timezone: string): {
  firstDate: string
  html: string
} {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import React from ${JSON.stringify(new URL("node_modules/react/index.js", appRoot).href)};
       import { renderToStaticMarkup } from ${JSON.stringify(new URL("node_modules/react-dom/server.node.js", appRoot).href)};
       import calendar from ${JSON.stringify(moduleUrl)};
       import Timeline from ${JSON.stringify(componentUrl)};
       console.log(JSON.stringify({firstDate: calendar.PLANNED_WEEKS[0].isoDate, html: renderToStaticMarkup(React.createElement(Timeline.default ?? Timeline))}));`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TZ: timezone,
        TSX_TSCONFIG_PATH: fileURLToPath(new URL("tsconfig.json", appRoot)),
      },
      timeout: 15000,
    },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test("planned calendar dates and server markup match across browser timezones", () => {
  const utc = renderInTimezone("UTC")
  assert.equal(utc.firstDate, "2026-04-28")
  assert.match(utc.html, /Weeks 1-2 \| Apr 28 - May 11/)
  for (const timezone of ["Pacific/Auckland", "America/Los_Angeles"]) {
    const actual = renderInTimezone(timezone)
    assert.equal(actual.firstDate, utc.firstDate, timezone)
    assert.equal(actual.html, utc.html, timezone)
  }
})
