/* global describe, expect, it, require */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")

const screen = fs.readFileSync(
  path.resolve(__dirname, "FeedbackQrScreen.tsx"),
  "utf8",
)
const qrHook = fs.readFileSync(
  path.resolve(__dirname, "useFeedbackQr.ts"),
  "utf8",
)

describe("TV feedback QR presentation", () => {
  it("does not print the long feedback URL below the QR", () => {
    expect(screen).not.toContain('url?.split("#")')
    expect(screen).not.toMatch(/<Text[^>]*>\{url\}/)
  })

  it("keeps the reference and expiry visible while the QR retains its URL", () => {
    expect(screen).toContain("Reference {verified.referenceCode} · Expires")
    expect(qrHook).toContain("code.addData(url)")
  })
})
