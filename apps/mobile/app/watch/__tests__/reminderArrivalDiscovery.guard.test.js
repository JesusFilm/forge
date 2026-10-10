// Plain JS (like seriesSearchDiscovery.guard.test.js): the RN tsconfig has no
// Node types, and this guard reads a route file from disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// One effect handles EVERY deep-link arrival at /watch/[slug], and a lapse
// reminder tap and an announcement tap are two of them. feat-516 marks an
// arrival as a shared link, so without the origin gates every reminder return
// is attributed to a share and every campaign return loses its nonce.
// The route has no render suite, so this pins the gates at the source: deleting
// the characters of `if (...)` compiles and stays green otherwise.
const APP = path.join(__dirname, "..", "..")
const source = fs.readFileSync(path.join(APP, "watch", "[slug].tsx"), "utf8")

/** Each `markPlaybackDiscovery(` call with the 200 characters before it. */
function markCallsWithContext() {
  const calls = []
  let index = source.indexOf("markPlaybackDiscovery(")
  while (index !== -1) {
    calls.push(source.slice(Math.max(0, index - 200), index))
    index = source.indexOf("markPlaybackDiscovery(", index + 1)
  }
  return calls
}

describe("a deep-link arrival is attributed by its own origin", () => {
  it("gates the share mark on a url arrival", () => {
    expect(source).toMatch(
      /if \(arrival\.origin === "url"\) markPlaybackDiscovery\(\s*decodedSlug,\s*"share",?\s*\)/,
    )
  })

  it("gates the acquisition mark on a campaign arrival with a nonce (KTD8)", () => {
    // The nonce is what admin joins on; a mark without it is an acquisition
    // the campaign report can never claim.
    expect(source).toMatch(
      /if \(arrival\.origin === "campaign" && arrival\.campaign != null\) \{\s*markPlaybackDiscovery\(decodedSlug, "acquisition", \{\s*campaign: arrival\.campaign,\s*\}\)/,
    )
  })

  it("marks discovery twice, and never ungated", () => {
    // Anti-vacuous: the two rules above still pass if a third, ungated
    // markPlaybackDiscovery call is added beside them. The import line does not
    // count, because only a CALL carries the parenthesis.
    const calls = markCallsWithContext()
    expect(calls).toHaveLength(2)
    for (const before of calls) {
      expect(before).toMatch(/if \(arrival\.origin === "(url|campaign)"/)
    }
  })

  it("reads a mark's context the way that rule intends (positive control)", () => {
    // Proves the reader counts CALL sites and sees what precedes each one.
    expect(markCallsWithContext().every((before) => before.length > 0)).toBe(
      true,
    )
  })

  it("still emits the arrival event for EVERY origin, gate or no gate", () => {
    // The gates must narrow the discovery marks only. Reminder and campaign
    // returns stay attributable through this event's own `origin` attribute.
    const effect = source.slice(source.indexOf("consumeDeepLinkArrival"))
    const event = effect.indexOf('datadogLog.info("content.deep_link_open"')
    const gate = effect.indexOf('if (arrival.origin === "url")')
    expect(event).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(-1)
    expect(event).toBeGreaterThan(gate)
    expect(effect.slice(event, event + 260)).toMatch(/origin: arrival\.origin/)
  })
})
