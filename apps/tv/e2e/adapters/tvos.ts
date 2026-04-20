import { execSync } from "node:child_process"
import { mkdirSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import type { TVAdapter, DpadDirection } from "../types"

/**
 * Maps D-pad directions to USB HID keyboard usage IDs.
 * `idb ui key <code>` sends these through SimulatorBridge (XPC) to the
 * simulator's UIFocusEngine — same pathway tvOS uses for external keyboards.
 * Verified on Apple TV 4K tvOS 26.1 simulator.
 */
const HID_KEYCODES: Record<DpadDirection, number> = {
  up: 82, // 0x52 Keyboard UpArrow
  down: 81, // 0x51 Keyboard DownArrow
  left: 80, // 0x50 Keyboard LeftArrow
  right: 79, // 0x4F Keyboard RightArrow
  select: 40, // 0x28 Keyboard Return (Enter)
  back: 41, // 0x29 Keyboard Escape (Menu button)
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
    const keycode = HID_KEYCODES[direction]
    // idb routes through SimulatorBridge (XPC), not macOS window system.
    // No frontmost-window requirement, no Accessibility permission, no interference
    // with host keyboard input.
    execSync(`idb ui key ${keycode}`, {
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
