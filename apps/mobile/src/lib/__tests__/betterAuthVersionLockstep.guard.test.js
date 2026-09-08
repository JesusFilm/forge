// Plain JS (like datadogReservedAttributes.guard.test.js): the RN tsconfig has
// no Node types, and this guard reads two package manifests from disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Mobile's Better Auth CLIENT must ship the SAME version as the apps/auth SERVER:
// a 2026-08-24 drift (#1978) 404'd every hosted sign-in with every mobile test green.
// `@better-auth/utils` is core's EXACT peer; a split pin breaks auth's typecheck.
const LOCKSTEP_PACKAGES = [
  "better-auth",
  "@better-auth/expo",
  "@better-auth/utils",
]

const MOBILE_MANIFEST = path.join(__dirname, "..", "..", "..", "package.json")
const AUTH_MANIFEST = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "auth",
  "package.json",
)

function readDependencies(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  return { ...manifest.devDependencies, ...manifest.dependencies }
}

describe("Better Auth client/server version lockstep", () => {
  const mobile = readDependencies(MOBILE_MANIFEST)
  const auth = readDependencies(AUTH_MANIFEST)

  it("reads both manifests (the guard cannot pass vacuously)", () => {
    expect(mobile["better-auth"]).toEqual(expect.any(String))
    expect(auth["better-auth"]).toEqual(expect.any(String))
  })

  it.each(LOCKSTEP_PACKAGES)(
    "pins %s to the exact version apps/auth runs",
    (name) => {
      // Exact pins on both sides: a caret range would let the two resolve
      // apart on the next lockfile refresh with both manifests unchanged.
      expect(mobile[name]).toMatch(/^\d+\.\d+\.\d+$/)
      expect(auth[name]).toMatch(/^\d+\.\d+\.\d+$/)
      expect(mobile[name]).toBe(auth[name])
    },
  )
})
