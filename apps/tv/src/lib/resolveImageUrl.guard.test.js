// Plain JS: the RN tsconfig has no Node types, and this guard needs fs/path to
// read source (same reason as zeroPii.guard.test.js and watchSearch.guard.test.js).
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The production static-asset host is a one-line revert surface. Swapping the
// base back to GitHub's raw endpoint compiles, typechecks, and leaves every
// behavioral test green — resolveImageUrl still returns "<base><path>" — while
// quietly putting a public TV audience behind a throttled, SLA-free
// source-viewing host that is pinned to whatever `main` currently holds and
// 404s the moment the repo is renamed or made private. No assertion on the
// function's OUTPUT can see that, so the host is pinned at the source.
//
// Re-verified 2026-08-19: www.jesusfilm.org/watch and the raw host returned
// byte-identical bodies for four assets, so the original "Cloudflare intercepts
// static paths" rationale no longer holds.
const SOURCE = fs.readFileSync(
  path.join(__dirname, "resolveImageUrl.ts"),
  "utf8",
)

/** Source minus comment lines, so prose about the old host can't satisfy a check. */
function activeCode(source) {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart()
      return !trimmed.startsWith("*") && !trimmed.startsWith("//")
    })
    .join("\n")
}

describe("resolveImageUrl production host (R20)", () => {
  it("never resolves production assets through GitHub's raw host", () => {
    expect(activeCode(SOURCE)).not.toMatch(/raw\.githubusercontent\.com/)
  })

  it("serves production assets from the web app's own domain", () => {
    expect(activeCode(SOURCE)).toMatch(/https:\/\/www\.jesusfilm\.org\/watch/)
  })
})
