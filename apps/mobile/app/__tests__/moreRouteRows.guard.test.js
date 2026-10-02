// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to find the route files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require, __dirname */
const fs = require("fs")
const path = require("path")

const { MY_WATCH_LINK_GROUPS } = require("../../src/lib/myWatchLinks")

const APP_DIR = path.join(__dirname, "..")

// The More screen test asserts the same route literal it pushes, so only a
// file check can catch a row that points at a route that no longer exists.
function routesWithoutFiles(routes) {
  return routes.filter(
    (route) => !fs.existsSync(path.join(APP_DIR, `${route.slice(1)}.tsx`)),
  )
}

const ROUTE_ROWS = MY_WATCH_LINK_GROUPS.flatMap((group) => group.links).filter(
  (link) => "route" in link,
)

describe("the More screen's in-app rows", () => {
  it("has at least one row that opens an app route", () => {
    expect(ROUTE_ROWS.length).toBeGreaterThanOrEqual(1)
  })

  it("points every in-app row at a route file under app/", () => {
    expect(routesWithoutFiles(ROUTE_ROWS.map((link) => link.route))).toEqual([])
  })

  it("flags a route with no file (positive control)", () => {
    expect(routesWithoutFiles(["/feedback", "/no-such-route"])).toEqual([
      "/no-such-route",
    ])
  })
})
