// Plain JS (like seriesSearchDiscovery.guard.test.js): the RN tsconfig has no
// Node types, and this guard reads a route file from disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// One effect handles EVERY deep-link arrival at /watch/[slug], and a lapse
// reminder tap is one of them. feat-516 marks an arrival as a shared link, so
// without the origin gate every reminder return is attributed to a share.
// The route has no render suite, so this pins the gate at the source: deleting
// the eight characters of `if (...)` compiles and stays green otherwise.
const APP = path.join(__dirname, "..", "..")
const source = fs.readFileSync(path.join(APP, "watch", "[slug].tsx"), "utf8")

describe("a lapse-reminder arrival is not attributed as a shared link", () => {
  it("gates the share mark on a url arrival", () => {
    expect(source).toMatch(
      /if \(arrival\.origin === "url"\) markPlaybackDiscovery\(\s*decodedSlug,\s*"share",?\s*\)/,
    )
  })

  it("marks share exactly once, and nowhere ungated", () => {
    // Anti-vacuous: the assertion above still passes if a second, ungated
    // markPlaybackDiscovery call is added beside it.
    const calls = source.match(/markPlaybackDiscovery\(/g) ?? []
    expect(calls).toHaveLength(1)
  })

  it("still emits the arrival event for EVERY origin, gate or no gate", () => {
    // The gate must narrow the discovery mark only. Reminder returns stay
    // attributable through this event's own `origin` attribute.
    const effect = source.slice(source.indexOf("consumeDeepLinkArrival"))
    const event = effect.indexOf('datadogLog.info("content.deep_link_open"')
    const gate = effect.indexOf('if (arrival.origin === "url")')
    expect(event).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(-1)
    expect(event).toBeGreaterThan(gate)
    expect(effect.slice(event, event + 260)).toMatch(/origin: arrival\.origin/)
  })
})
