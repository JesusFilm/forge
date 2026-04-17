import { execSync } from "node:child_process"
import { mkdirSync, existsSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { TVAdapter, DpadDirection } from "../types"

/** Maps D-pad directions to Android TV keyevent codes */
const KEY_EVENTS: Record<DpadDirection, number> = {
  up: 19, // KEYCODE_DPAD_UP
  down: 20, // KEYCODE_DPAD_DOWN
  left: 21, // KEYCODE_DPAD_LEFT
  right: 22, // KEYCODE_DPAD_RIGHT
  select: 23, // KEYCODE_DPAD_CENTER
  back: 4, // KEYCODE_BACK
}

function getAdbPath(): string {
  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (androidHome) {
    return `${androidHome}/platform-tools/adb`
  }
  // Fall back to PATH
  try {
    execSync("which adb", { stdio: "pipe" })
    return "adb"
  } catch {
    throw new Error(
      "adb not found. Set $ANDROID_HOME or $ANDROID_SDK_ROOT.\n" +
        'Typical path: export ANDROID_HOME="$HOME/Library/Android/sdk"\n' +
        'Add to PATH: export PATH="$ANDROID_HOME/platform-tools:$PATH"',
    )
  }
}

export class AndroidTvAdapter implements TVAdapter {
  readonly platform = "androidtv" as const
  private adb: string

  constructor() {
    this.adb = getAdbPath()
  }

  async checkAvailability(): Promise<void> {
    try {
      const output = execSync(`${this.adb} devices`, {
        stdio: "pipe",
        encoding: "utf-8",
      })
      const devices = output
        .split("\n")
        .filter((line) => line.includes("device") && !line.includes("List"))
      if (devices.length === 0) {
        throw new Error("No connected devices")
      }
    } catch (err) {
      if (err instanceof Error && err.message === "No connected devices") {
        throw new Error(
          "No Android TV device/emulator connected.\n" +
            "Start one with: $ANDROID_HOME/emulator/emulator -avd <avd-name>",
        )
      }
      throw err
    }
  }

  async sendDpad(direction: DpadDirection): Promise<void> {
    const keyEvent = KEY_EVENTS[direction]
    execSync(`${this.adb} shell input keyevent ${keyEvent}`, {
      stdio: "pipe",
      timeout: 5000,
    })
  }

  async captureScreenshot(outputPath: string): Promise<void> {
    const dir = dirname(outputPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const buffer = execSync(`${this.adb} exec-out screencap -p`, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 10000,
    })
    writeFileSync(outputPath, buffer)
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
      execSync(
        `${this.adb} shell monkey -p ${bundleId} -c android.intent.category.LAUNCHER 1`,
        { stdio: "pipe", timeout: 15000 },
      )
    } catch {
      throw new Error(
        `Failed to launch ${bundleId} on Android TV.\n` +
          "Ensure the app is installed: EXPO_TV=1 expo run:android",
      )
    }
  }
}
