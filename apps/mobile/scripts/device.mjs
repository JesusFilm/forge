#!/usr/bin/env node

/**
 * Launches the Expo dev server and provides interactive keys
 * to deploy to real connected devices instead of simulators.
 *
 * Usage: node scripts/real-device.mjs
 *
 * Keys:
 *   i — build and run on a connected iOS device
 *   a — build and run on a connected Android device
 *   q — quit
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ── ADB path resolution ───────────────────────────────────────────────────

function findAdb() {
  const candidates = [
    process.env.ANDROID_HOME &&
      join(process.env.ANDROID_HOME, "platform-tools", "adb"),
    join(homedir(), "Library", "Android", "sdk", "platform-tools", "adb"),
    "adb", // fallback to PATH
  ].filter(Boolean)
  return candidates.find((p) => p === "adb" || existsSync(p)) ?? "adb"
}

const ADB = findAdb()

// ── Helpers ────────────────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts })
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
    )
    child.on("error", reject)
  })
}

function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    child.stdout.on("data", (d) => (stdout += d))
    child.on("close", () => resolve(stdout))
    child.on("error", reject)
  })
}

// ── Device detection ───────────────────────────────────────────────────────

async function findIosDevices() {
  try {
    // devicectl -j requires a file path; write to a temp file
    const tmpFile = `/tmp/forge-devices-${Date.now()}.json`
    await run("xcrun", ["devicectl", "list", "devices", "-j", tmpFile], {
      stdio: "ignore",
    })
    const { readFileSync, unlinkSync } = await import("node:fs")
    const json = JSON.parse(readFileSync(tmpFile, "utf8"))
    unlinkSync(tmpFile)

    return (json.result?.devices ?? [])
      .filter((d) => {
        const conn = d.connectionProperties ?? {}
        // Device is usable if it's paired and physically connected (wired/wifi)
        // tunnelState is unreliable — it can say 'disconnected' even when the device is available
        return conn.pairingState === "paired" && conn.transportType != null
      })
      .map((d) => ({
        name: d.deviceProperties?.name ?? "iOS Device",
        udid: d.hardwareProperties?.udid ?? d.identifier,
      }))
  } catch {
    // fallback: parse the human-readable table output
    const out = await runCapture("xcrun", ["devicectl", "list", "devices"])
    const lines = out.split("\n")
    return lines
      .filter(
        (l) =>
          /\b(connected|available)\b/i.test(l) && !/\bunavailable\b/i.test(l),
      )
      .map((l) => {
        // Table columns: Name, Hostname, Identifier, State, Model
        const cols = l.split(/\s{2,}/).map((s) => s.trim())
        if (cols.length >= 4) {
          return { name: cols[0], udid: cols[2] }
        }
        return null
      })
      .filter(Boolean)
  }
}

async function findAndroidDevices() {
  const out = await runCapture(ADB, ["devices", "-l"])
  const devices = out
    .split("\n")
    .slice(1)
    .filter((l) => l.includes("device") && !l.includes("emulator"))
    .map((l) => {
      const [serial] = l.split(/\s+/)
      const modelMatch = l.match(/model:(\S+)/)
      const deviceMatch = l.match(/device:(\S+)/)
      return {
        serial,
        model: modelMatch?.[1] ?? serial,
        device: deviceMatch?.[1] ?? serial,
      }
    })
    .filter((d) => d.serial)

  // Resolve friendly name via `adb shell` for Expo's --device flag
  for (const d of devices) {
    try {
      const name = (
        await runCapture(ADB, [
          "-s",
          d.serial,
          "shell",
          "settings",
          "get",
          "global",
          "device_name",
        ])
      ).trim()
      d.name = name || d.model
    } catch {
      d.name = d.model
    }
  }
  return devices
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log("\n📱 Forge — Real Device Mode\n")
console.log("─────────────────────────────────────────")
console.log("  Press a key to build & run:")
console.log("    i  →  iOS device")
console.log("    a  →  Android device")
console.log("    q  →  quit")
console.log("─────────────────────────────────────────\n")

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding("utf8")

  let busy = false

  process.stdin.on("data", async (key) => {
    if (key === "q" || key === "\u0003") {
      process.exit(0)
    }

    if (busy) return

    if (key === "i") {
      busy = true
      try {
        const devices = await findIosDevices()
        if (devices.length === 0) {
          console.log("\n⚠️  No connected iOS devices found.")
          console.log("   Make sure the device is plugged in and trusted.\n")
          busy = false
          return
        }
        console.log(
          `\n📲 Found iOS device: ${devices[0].name} (${devices[0].udid})`,
        )
        console.log(
          "   Building and installing (this may take a few minutes)...\n",
        )
        // expo run:ios --device builds the native project, installs it,
        // and starts the bundler — no pre-installed dev client needed.
        await run("npx", ["expo", "run:ios", "--device", devices[0].udid])
      } catch (err) {
        console.error("iOS launch failed:", err.message)
      }
      busy = false
    }

    if (key === "a") {
      busy = true
      try {
        const devices = await findAndroidDevices()
        if (devices.length === 0) {
          console.log("\n⚠️  No connected Android devices found.")
          console.log(
            "   Make sure USB debugging is enabled and the device is plugged in.\n",
          )
          busy = false
          return
        }
        console.log(
          `\n📲 Found Android device: ${devices[0].name} (${devices[0].serial})`,
        )
        console.log(
          "   Building and installing (this may take a few minutes)...\n",
        )
        // Build with Gradle, install via adb, then start bundler
        console.log("   Building with Gradle...\n")
        await run("./android/gradlew", ["-p", "android", "assembleDebug"])
        const apkPath = "android/app/build/outputs/apk/debug/app-debug.apk"
        console.log(`\n   Installing on ${devices[0].name}...\n`)
        await run(ADB, ["-s", devices[0].serial, "install", "-r", apkPath])
        // Launch the app
        await run(ADB, [
          "-s",
          devices[0].serial,
          "shell",
          "am",
          "start",
          "-n",
          "org.jesusfilm.forgeexpo/.MainActivity",
        ])
        console.log("\n✅ App installed and launched!")
        console.log("   Starting Metro bundler...\n")
        run("npx", ["expo", "start", "--lan"])
      } catch (err) {
        console.error("Android launch failed:", err.message)
      }
      busy = false
    }
  })
} else {
  console.error(
    "Error: stdin is not a TTY. Run this script in an interactive terminal.",
  )
  process.exit(1)
}
