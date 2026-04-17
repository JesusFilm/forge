import { execSync } from "node:child_process"
import { mkdirSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import type { TVAdapter, DpadDirection } from "../types"

/** Maps D-pad directions to macOS key codes for Apple TV Simulator */
const KEY_CODES: Record<DpadDirection, number> = {
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  select: 36, // Enter
  back: 53, // Escape / Menu
}

export class TvOSAdapter implements TVAdapter {
  readonly platform = "tvos" as const

  async checkAvailability(): Promise<void> {
    try {
      execSync("xcrun simctl list devices booted", { stdio: "pipe" })
    } catch {
      throw new Error(
        "No booted tvOS Simulator found.\n" +
          "Start one with: xcrun simctl boot 'Apple TV'\n" +
          "Then open Simulator.app.",
      )
    }

    try {
      execSync(
        "osascript -e 'tell application \"System Events\" to name of processes'",
        { stdio: "pipe" },
      )
    } catch {
      throw new Error(
        "macOS Accessibility permissions required for osascript keystroke injection.\n" +
          "Grant access in: System Settings > Privacy & Security > Accessibility > Terminal/iTerm",
      )
    }
  }

  async sendDpad(direction: DpadDirection): Promise<void> {
    const keyCode = KEY_CODES[direction]
    // Raise the Simulator window to ensure keystrokes reach it
    const script = `
      tell application "Simulator"
        activate
      end tell
      delay 0.1
      tell application "System Events"
        key code ${keyCode}
      end tell
    `
    execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, {
      stdio: "pipe",
      timeout: 5000,
    })
  }

  async captureScreenshot(outputPath: string): Promise<void> {
    const dir = dirname(outputPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    execSync(`xcrun simctl io booted screenshot "${outputPath}"`, {
      stdio: "pipe",
      timeout: 10000,
    })
  }

  async launchApp(bundleId: string): Promise<void> {
    try {
      execSync(`xcrun simctl launch booted "${bundleId}"`, {
        stdio: "pipe",
        timeout: 15000,
      })
    } catch {
      throw new Error(
        `Failed to launch ${bundleId} on tvOS Simulator.\n` +
          "Ensure the app is installed: EXPO_TV=1 expo run:ios",
      )
    }
  }
}
