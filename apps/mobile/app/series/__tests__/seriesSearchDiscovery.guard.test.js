// Plain JS (like datadogReservedAttributes.guard.test.js): the RN tsconfig has
// no Node types, and this guard needs fs/path to read two route files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// feat-516: an episode opened from a series SEARCH result must be attributed
// `search`. The search tab cannot mark it (no episode slug exists yet), so the
// tab carries the hand-off in a route param and the series page marks the
// tapped episode. The series screen has no render suite, so this pins the
// wiring at the source: a revert of either half compiles and stays green.
const APP = path.join(__dirname, "..", "..")
const read = (file) => fs.readFileSync(path.join(APP, file), "utf8")

describe("series search result -> episode discovery mark", () => {
  it("the search tab carries the hand-off into the series route only", () => {
    const source = read(path.join("(tabs)", "watch.tsx"))
    expect(source).toMatch(
      /route === "series"\s*\?\s*`&\$\{DISCOVERY_ROUTE_PARAM\}=search`\s*:\s*""/,
    )
    // A single video still gets the direct mark, gated on the watch route.
    expect(source).toMatch(
      /if \(route === "watch"\) markPlaybackDiscovery\(result\.slug, "search"\)/,
    )
    expect(source).toMatch(/\?seed=\$\{seed\}\$\{discovery\}/)
  })

  it("the series page reads the param and marks the tapped episode before it navigates", () => {
    const source = read(path.join("series", "[slug].tsx"))
    expect(source).toMatch(/from: fromParam,/)
    expect(source).toMatch(
      /const discoverySource = discoverySourceFromParam\(fromParam\)/,
    )
    const handler = source.slice(source.indexOf("const handleSelectEpisode"))
    const mark = handler.indexOf(
      "if (discoverySource) markPlaybackDiscovery(episode.slug, discoverySource)",
    )
    const push = handler.indexOf("router.push(`/watch/")
    expect(mark).toBeGreaterThan(-1)
    expect(push).toBeGreaterThan(mark)
    // The mark rides the handler's dependency list, or a stale closure could
    // mark with a source from an earlier navigation.
    expect(handler).toMatch(/\[router, discoverySource\],/)
  })

  it("the route param name is one constant on both sides", () => {
    const discovery = read(
      path.join("..", "src", "lib", "recommendations", "playbackDiscovery.ts"),
    )
    expect(discovery).toMatch(/export const DISCOVERY_ROUTE_PARAM = "from"/)
    const series = read(path.join("series", "[slug].tsx"))
    expect(series).toMatch(/from\?: string/)
  })
})
