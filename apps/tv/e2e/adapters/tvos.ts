import { execSync } from "node:child_process"
import { mkdirSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import type { TVAdapter, DpadDirection } from "../types"

/** Maps D-pad directions to idb remote button names (Siri Remote mapping) */
const IDB_BUTTONS: Record<DpadDirection, string> = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  select: "Select",
  back: "Menu",
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
      execSync("idb --help", { stdio: "pipe" })
    } catch {
      throw new Error(
        "idb (Facebook iOS Development Bridge) is not installed.\n" +
          "Install: brew tap facebook/fb && brew install idb-companion && pipx install fb-idb\n" +
          "Docs: https://fbidb.io/",
      )
    }
  }

  async sendDpad(direction: DpadDirection): Promise<void> {
    const button = IDB_BUTTONS[direction]
    // idb routes through SimulatorBridge (XPC), not macOS window system.
    // No frontmost-window requirement, no Accessibility permission, no interference
    // with host keyboard input.
    execSync(`idb ui button --button ${button}`, {
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

  private validateBundleId(bundleId: string): void {
    if (!/^[a-zA-Z0-9._-]+$/.test(bundleId)) {
      throw new Error(
        `Invalid bundle ID: ${bundleId}. Must match /^[a-zA-Z0-9._-]+$/`,
      )
    }
  }

  async launchApp(bundleId: string): Promise<void> {
    this.validateBundleId(bundleId)
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
