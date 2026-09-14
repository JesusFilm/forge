/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require("node:child_process")

const apk = process.argv[2]
if (!apk)
  throw new Error("Usage: node scripts/verify-android-tv-play-apk.js <apk>")
const badging = execFileSync(
  process.env.AAPT2 || "aapt2",
  ["dump", "badging", apk],
  { encoding: "utf8" },
)
const lines = badging.split("\n").map((line) => line.trim())
for (const name of [
  "android.hardware.screen.portrait",
  "android.hardware.microphone",
]) {
  if (
    !lines.includes(`uses-feature-not-required: name='${name}'`) ||
    lines.some(
      (line) =>
        line.startsWith(`uses-feature: name='${name}'`) ||
        line.startsWith(`uses-implied-feature: name='${name}'`),
    )
  ) {
    throw new Error(`Google Play compatibility: ${name} must be optional`)
  }
}
process.stdout.write(
  "PASS: portrait-screen and microphone hardware are optional\n",
)
