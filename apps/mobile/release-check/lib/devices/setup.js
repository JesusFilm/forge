"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The one-time setup (R4, KTD15): it checks the Mac's tools, names each
// missing item with the one command that gets it, and creates the five
// pinned devices. `setup --check` creates nothing and downloads nothing.

const fs = require("node:fs")
const path = require("node:path")

const { EXIT } = require("../contract")
const { run } = require("../proc")
const { PASSTHROUGH_KEYS } = require("../testBuild/env")
const android = require("./android")
const inventoryLib = require("./inventory")
const { isExecutable, resolveOnPath } = inventoryLib
const ios = require("./ios")

const CHECK_TIMEOUT_MS = 30000
const MAESTRO_TIMEOUT_MS = 90000
const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000
const LICENSE_PROMPT = /licen[cs]es?.*not (been )?accepted|Accept\? \(y\/N\)/i

function maestroInstallCommand(version) {
  return `curl -fsSL "https://get.maestro.mobile.dev" | MAESTRO_VERSION=${version} bash`
}

function problem(code, message, command = null, deviceId = null) {
  return { code, message, command, deviceId }
}

function quote(file) {
  return `"${file}"`
}

function exists(file) {
  return fs.existsSync(file)
}

function packageRevision(folder) {
  try {
    const props = inventoryLib.parseIni(
      fs.readFileSync(path.join(folder, "source.properties"), "utf8"),
    )
    return props["Pkg.Revision"] ?? null
  } catch {
    return null
  }
}

function runtimeVersion(runtimeId) {
  return /iOS-(\d+)-(\d+)$/.exec(runtimeId)?.slice(1).join(".") ?? runtimeId
}

async function checkXcode(ctx) {
  const xcodebuild = await ctx.runChild("/usr/bin/xcodebuild", ["-version"], {
    env: ctx.env,
    timeoutMs: CHECK_TIMEOUT_MS,
  })
  if (xcodebuild.code !== 0) {
    ctx.problems.push(
      problem(
        "XCODE_MISSING",
        "Xcode is not installed or not selected; install it from the App Store, then select it.",
        "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
      ),
    )
    return null
  }
  const lines = xcodebuild.stdout.trim().split("\n")
  const version = `${lines[0].replace(/^Xcode\s+/, "")} (${(lines[1] ?? "").replace(/^Build version\s+/, "")})`
  ctx.observed.xcode = version
  const firstLaunch = await ctx.runChild(
    "/usr/bin/xcodebuild",
    ["-checkFirstLaunchStatus"],
    { env: ctx.env, timeoutMs: CHECK_TIMEOUT_MS },
  )
  if (firstLaunch.code !== 0) {
    ctx.problems.push(
      problem(
        "XCODE_FIRST_LAUNCH",
        "Xcode has not finished its first-launch step.",
        "sudo xcodebuild -runFirstLaunch",
      ),
    )
    return null
  }
  return version
}

async function simctlJson(ctx, kind) {
  const result = await ctx.runChild(
    inventoryLib.XCRUN,
    ["simctl", "list", "-j", kind],
    {
      env: ctx.env,
      timeoutMs: CHECK_TIMEOUT_MS,
      tailBytes: inventoryLib.LIST_TAIL_BYTES,
    },
  )
  return result.code === 0 ? JSON.parse(result.stdout) : null
}

/** Returns the set of device ids whose runtime and device type exist. */
async function checkIosPlatform(ctx) {
  const ready = new Set()
  const runtimes = await simctlJson(ctx, "runtimes")
  const types = await simctlJson(ctx, "devicetypes")
  if (!runtimes || !types) {
    ctx.problems.push(
      problem(
        "SIMCTL_FAILED",
        "simctl did not list the iOS runtimes and device types.",
      ),
    )
    return ready
  }
  const iosDevices = ctx.config.devices.filter(
    (device) => device.platform === "ios",
  )
  const missingRuntimes = new Set()
  for (const device of iosDevices) {
    const runtime = runtimes.runtimes.find(
      (entry) => entry.identifier === device.runtime,
    )
    if (!runtime || runtime.isAvailable === false) {
      missingRuntimes.add(device.runtime)
      continue
    }
    ctx.observed.iosRuntime = `${runtime.version} (${runtime.buildversion})`
    if (
      !types.devicetypes.some((entry) => entry.identifier === device.deviceType)
    ) {
      ctx.problems.push(
        problem(
          "IOS_DEVICE_TYPE_MISSING",
          `This Xcode has no ${device.deviceType} device type; install the Xcode version in the release check README.`,
          null,
          device.id,
        ),
      )
      continue
    }
    ready.add(device.id)
  }
  for (const runtime of missingRuntimes) {
    ctx.problems.push(
      problem(
        "IOS_RUNTIME_MISSING",
        `The iOS runtime ${runtime} is not installed.`,
        `xcodebuild -downloadPlatform iOS -buildVersion ${runtimeVersion(runtime)}`,
      ),
    )
  }
  return ready
}

async function checkJava(ctx) {
  const major = ctx.config.tools.javaMajor
  const candidates = []
  if (ctx.sourceEnv.JAVA_HOME) candidates.push(ctx.sourceEnv.JAVA_HOME)
  const javaHome = await ctx.runChild(
    "/usr/libexec/java_home",
    ["-v", String(major)],
    {
      env: ctx.env,
      timeoutMs: CHECK_TIMEOUT_MS,
    },
  )
  if (javaHome.code === 0) candidates.push(javaHome.stdout.trim())
  for (const home of candidates) {
    const java = await ctx.runChild(path.join(home, "bin/java"), ["-version"], {
      env: ctx.env,
      timeoutMs: CHECK_TIMEOUT_MS,
    })
    const version = /version "([\d._]+)"/.exec(
      `${java.stderr}${java.stdout}`,
    )?.[1]
    if (java.code === 0 && version && Number(version.split(".")[0]) === major) {
      ctx.observed.java = version
      return home
    }
  }
  ctx.problems.push(
    problem(
      "JAVA_MISSING",
      `Java ${major} is not installed.`,
      `brew install --cask corretto@${major}`,
    ),
  )
  return null
}

function checkAndroidSdk(ctx) {
  const { paths } = ctx
  if (!exists(paths.sdkRoot)) {
    ctx.problems.push(
      problem(
        "ANDROID_SDK_MISSING",
        `The Android SDK is not at ${paths.sdkRoot}; install Android Studio and open its SDK Manager once, or set ANDROID_HOME.`,
      ),
    )
    return false
  }
  let ok = true
  if (!isExecutable(paths.sdkmanager) || !isExecutable(paths.avdmanager)) {
    ctx.problems.push(
      problem(
        "ANDROID_CMDLINE_TOOLS_MISSING",
        "The Android SDK Command-line Tools are missing; install them in Android Studio, SDK Manager, SDK Tools.",
      ),
    )
    return false
  }
  const missing = []
  if (!isExecutable(paths.adb)) missing.push("platform-tools")
  if (!isExecutable(paths.emulator)) missing.push("emulator")
  if (missing.length > 0) {
    ctx.problems.push(
      problem(
        "ANDROID_TOOLS_MISSING",
        `The Android SDK has no ${missing.join(" or ")} package.`,
        `${quote(paths.sdkmanager)} --install ${missing.join(" ")}`,
      ),
    )
    ok = false
  }
  const emulatorVersion = packageRevision(path.join(paths.sdkRoot, "emulator"))
  ctx.observed.emulator = emulatorVersion
  if (emulatorVersion && emulatorVersion !== ctx.config.pins.emulatorVersion) {
    ctx.notes.push(
      `The emulator is version ${emulatorVersion}, and the pin is ${ctx.config.pins.emulatorVersion}.`,
    )
  }
  return ok
}

async function checkMaestro(ctx) {
  const want = ctx.config.tools.maestro
  const bin =
    ctx.sourceEnv.MAESTRO_BIN || resolveOnPath("maestro", ctx.sourceEnv.PATH)
  if (!bin) {
    ctx.problems.push(
      problem(
        "MAESTRO_MISSING",
        "Maestro is not installed.",
        maestroInstallCommand(want),
      ),
    )
    return
  }
  const result = await ctx.runChild(bin, ["--version"], {
    env: ctx.env,
    timeoutMs: MAESTRO_TIMEOUT_MS,
  })
  const version = String(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => /^\d+\.\d+\.\d+$/.test(line))
  ctx.observed.maestro = version ?? null
  if (!version) {
    ctx.problems.push(
      problem(
        "MAESTRO_MISSING",
        `${bin} --version printed no version.`,
        maestroInstallCommand(want),
      ),
    )
  } else if (version !== want) {
    ctx.problems.push(
      problem(
        "MAESTRO_VERSION",
        `Maestro ${version} is installed at ${bin}, and the runner needs ${want}.`,
        maestroInstallCommand(want),
      ),
    )
  }
}

// The iOS build runs `pod install` with the shell's PATH and Ruby settings, so
// the check runs `pod` the same way: an rbenv shim with no gem fails here.
async function checkCocoaPods(ctx) {
  const env = { LANG: "en_US.UTF-8" }
  for (const key of PASSTHROUGH_KEYS) {
    if (ctx.sourceEnv[key]) env[key] = ctx.sourceEnv[key]
  }
  const bin = resolveOnPath("pod", ctx.sourceEnv.PATH)
  const result = bin
    ? await ctx.runChild(bin, ["--version"], {
        env,
        timeoutMs: CHECK_TIMEOUT_MS,
      })
    : null
  const version =
    result?.code === 0
      ? (/^\d+\.\d+\.\d+$/m.exec(String(result.stdout))?.[0] ?? null)
      : null
  ctx.observed.cocoapods = version
  if (version) return
  ctx.problems.push(
    problem(
      "COCOAPODS_MISSING",
      bin
        ? `${bin} --version printed no version; the iOS build runs pod install.`
        : "CocoaPods is not installed; the iOS build runs pod install.",
      "brew install cocoapods",
    ),
  )
}

async function readObservedKeyboard(ctx) {
  const result = await ctx.runChild(
    "/usr/bin/defaults",
    ["read", "com.apple.iphonesimulator", "ConnectHardwareKeyboard"],
    { env: ctx.env, timeoutMs: CHECK_TIMEOUT_MS },
  )
  ctx.observed.simulatorHardwareKeyboard =
    result.code === 0 ? result.stdout.trim() === "1" : null
}

/** Returns `installed`, `downloadable` (`--check` only), or `blocked`. */
async function ensureAndroidImage(ctx) {
  const image = ctx.config.devices.find(
    (device) => device.platform === "android",
  )?.image
  const folder = android.packageFolder(ctx.paths.sdkRoot, image)
  const download = {
    package: image,
    approxMb: ctx.config.downloads.androidImageMb,
    installed: false,
  }
  ctx.downloads.push(download)
  const present = exists(path.join(folder, "source.properties"))
  if (!present && ctx.check) {
    if (exists(path.join(ctx.paths.sdkRoot, "licenses/android-sdk-license"))) {
      return "downloadable"
    }
    ctx.problems.push(licenseProblem(ctx))
    return "blocked"
  }
  if (!present) {
    const result = await ctx.runChild(
      ctx.paths.sdkmanager,
      ["--install", image],
      {
        env: ctx.env,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      },
    )
    if (LICENSE_PROMPT.test(`${result.stdout}\n${result.stderr}`)) {
      ctx.problems.push(licenseProblem(ctx))
      return "blocked"
    }
    if (!exists(path.join(folder, "source.properties"))) {
      const outcome = inventoryLib.toolOutcome(
        result,
        "sdkmanager --install",
        DOWNLOAD_TIMEOUT_MS,
      )
      ctx.problems.push(
        problem(
          "ANDROID_IMAGE_DOWNLOAD_FAILED",
          `sdkmanager did not install ${image}: ${outcome.error ?? "the image folder is missing"}.`,
          `${quote(ctx.paths.sdkmanager)} --install "${image}"`,
        ),
      )
      return "blocked"
    }
    ctx.actions.push(`downloaded ${image}`)
  }
  download.installed = true
  const revision = packageRevision(folder)
  ctx.observed.androidImageRevision =
    revision === null ? null : Number(revision)
  if (Number(revision) !== ctx.config.pins.imageRevision) {
    ctx.notes.push(
      `The ${image} image is revision ${revision}, and the pin is ${ctx.config.pins.imageRevision}.`,
    )
  }
  return "installed"
}

function licenseProblem(ctx) {
  return problem(
    "ANDROID_SDK_LICENSE",
    "The Android SDK licenses are not accepted; run this command and accept each license.",
    `${quote(ctx.paths.sdkmanager)} --licenses`,
  )
}

async function checkProfiles(ctx) {
  const wanted = ctx.config.devices
    .filter((device) => device.platform === "android")
    .map((device) => device.profile)
  const result = await ctx.runChild(
    ctx.paths.avdmanager,
    ["list", "device", "-c"],
    {
      env: ctx.env,
      timeoutMs: CHECK_TIMEOUT_MS,
    },
  )
  const listed = new Set(
    String(result.stdout)
      .split("\n")
      .map((line) => line.trim()),
  )
  const missing = wanted.filter((profile) => !listed.has(profile))
  if (missing.length > 0) {
    ctx.problems.push(
      problem(
        "AVD_PROFILE_MISSING",
        `avdmanager has no ${missing.join(" or ")} hardware profile; update the command-line tools.`,
        `${quote(ctx.paths.sdkmanager)} --install "cmdline-tools;latest"`,
      ),
    )
    return false
  }
  return true
}

function deviceResult(device, status, detail = null) {
  return {
    id: device.id,
    platform: device.platform,
    name: device.platform === "ios" ? device.name : device.avd,
    status,
    detail,
  }
}

async function setupSimulator(ctx, device, entry, ready) {
  if (entry) {
    const mismatches = []
    if (entry.runtime !== device.runtime) {
      mismatches.push(
        `runtime is ${entry.runtime}, and the pin is ${device.runtime}`,
      )
    }
    if (entry.deviceType !== device.deviceType) {
      mismatches.push(
        `device type is ${entry.deviceType}, and the pin is ${device.deviceType}`,
      )
    }
    if (mismatches.length === 0) return deviceResult(device, "ok", entry.udid)
    ctx.problems.push(
      problem(
        "DEVICE_PIN_MISMATCH",
        `${device.name} exists, but its ${mismatches.join("; its ")}; setup does not change it. Delete it, then run setup again.`,
        `xcrun simctl delete ${entry.udid}`,
        device.id,
      ),
    )
    return deviceResult(device, "mismatch", mismatches.join("; "))
  }
  if (!ready) return deviceResult(device, "blocked")
  if (ctx.check) return deviceResult(device, "missing")
  const created = await ios.createSimulatorDevice(device, {
    runChild: ctx.runChild,
    env: ctx.env,
  })
  if (!created.ok) {
    ctx.problems.push(
      problem("DEVICE_CREATE_FAILED", `${created.error}.`, null, device.id),
    )
    return deviceResult(device, "failed", created.error)
  }
  ctx.actions.push(`created ${device.name}`)
  return deviceResult(device, "created", created.udid)
}

async function setupAvd(ctx, device, entry, ready) {
  const pins = ctx.config.pins
  if (entry) {
    if (!entry.settings) {
      ctx.problems.push(
        problem(
          "DEVICE_PIN_MISMATCH",
          `${device.avd} exists, but its config.ini cannot be read; setup does not change it. Delete it, then run setup again.`,
          `${quote(ctx.paths.avdmanager)} delete avd -n ${device.avd}`,
          device.id,
        ),
      )
      return deviceResult(device, "mismatch", "config.ini cannot be read")
    }
    const mismatch = android.avdMismatches(entry.settings, device, pins)
    if (mismatch.fixed.length > 0) {
      ctx.problems.push(
        problem(
          "DEVICE_PIN_MISMATCH",
          `${device.avd} exists, but its ${mismatch.fixed.join("; its ")}; setup does not change it. Delete it, then run setup again.`,
          `${quote(ctx.paths.avdmanager)} delete avd -n ${device.avd}`,
          device.id,
        ),
      )
      return deviceResult(device, "mismatch", mismatch.fixed.join("; "))
    }
    if (mismatch.pins.length === 0) return deviceResult(device, "ok")
    const keys = mismatch.pins.map((pin) => pin.key).join(", ")
    if (ctx.check) return deviceResult(device, "unpinned", keys)
    android.applyAvdPins(entry.configFile, pins)
    ctx.actions.push(`pinned ${keys} on ${device.avd}`)
    return deviceResult(device, "pinned", keys)
  }
  if (!ready) return deviceResult(device, "blocked")
  if (ctx.check) return deviceResult(device, "missing")
  const created = await android.createAvd(device, {
    runChild: ctx.runChild,
    env: ctx.env,
    paths: ctx.paths,
  })
  if (created.profileQuestion) {
    ctx.problems.push(
      problem(
        "AVD_PROFILE_QUESTION",
        `avdmanager asked about a custom hardware profile for ${device.avd}; run this command, answer no, then run setup again.`,
        created.command,
        device.id,
      ),
    )
    return deviceResult(device, "failed", created.error)
  }
  if (!created.ok) {
    ctx.problems.push(
      problem("DEVICE_CREATE_FAILED", `${created.error}.`, null, device.id),
    )
    return deviceResult(device, "failed", created.error)
  }
  const { file } = inventoryLib.readAvdConfig(ctx.paths.avdHome, device.avd)
  android.applyAvdPins(file, pins)
  ctx.actions.push(`created ${device.avd}`)
  return deviceResult(device, "created")
}

// Each problem is `{ code, message, command, deviceId }`, and `command` is
// the one thing the person runs.
async function runSetup(options = {}) {
  const sourceEnv = options.sourceEnv ?? process.env
  const ctx = {
    check: Boolean(options.check),
    config: options.config ?? inventoryLib.loadDeviceConfig(),
    runChild: options.runChild ?? run,
    sourceEnv,
    env: inventoryLib.toolEnv(sourceEnv),
    paths: inventoryLib.toolPaths(sourceEnv),
    problems: [],
    notes: [],
    actions: [],
    downloads: [],
    observed: {
      hostTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  }

  const xcode = await checkXcode(ctx)
  const iosReady = xcode ? await checkIosPlatform(ctx) : new Set()
  await checkCocoaPods(ctx)
  await readObservedKeyboard(ctx)
  const javaHome = await checkJava(ctx)
  if (javaHome)
    ctx.env = inventoryLib.toolEnv(sourceEnv, { JAVA_HOME: javaHome })
  const sdkReady = checkAndroidSdk(ctx) && javaHome !== null
  await checkMaestro(ctx)

  const inventory = await inventoryLib.listInventory({
    config: ctx.config,
    env: ctx.env,
    runChild: ctx.runChild,
    paths: ctx.paths,
  })
  for (const error of inventory.errors) {
    ctx.problems.push(problem("INVENTORY_FAILED", `${error.message}.`))
  }

  const androidDevices = ctx.config.devices.filter(
    (device) => device.platform === "android",
  )
  const avdMissing = androidDevices.some(
    (device) => !inventory.owned.some((entry) => entry.avd === device.avd),
  )
  let androidReady = false
  if (sdkReady) {
    const image = await ensureAndroidImage(ctx)
    const imageOk = image === "installed" || image === "downloadable"
    androidReady = imageOk && (!avdMissing || (await checkProfiles(ctx)))
  }

  const devices = []
  for (const device of ctx.config.devices) {
    if (device.platform === "ios") {
      const entry = inventory.owned.find(
        (owned) => owned.platform === "ios" && owned.name === device.name,
      )
      devices.push(
        await setupSimulator(ctx, device, entry, iosReady.has(device.id)),
      )
    } else {
      const entry = inventory.owned.find((owned) => owned.avd === device.avd)
      devices.push(await setupAvd(ctx, device, entry, androidReady))
    }
  }

  let warmed = null
  if (!ctx.check && options.warmBuildCaches && ctx.problems.length === 0) {
    try {
      const result = await options.warmBuildCaches({ env: ctx.env })
      warmed = result?.ok !== false
      if (!warmed) {
        ctx.problems.push(
          problem(
            "BUILD_CACHE_WARM_FAILED",
            `${result.message ?? "The cache-warming build failed"}.`,
          ),
        )
      }
    } catch (error) {
      warmed = false
      ctx.problems.push(problem("BUILD_CACHE_WARM_FAILED", `${error.message}.`))
    }
  }

  const done = new Set(["ok", "created", "pinned"])
  return {
    ready:
      ctx.problems.length === 0 &&
      devices.every((device) => done.has(device.status)),
    check: ctx.check,
    problems: ctx.problems,
    notes: ctx.notes,
    devices,
    downloads: ctx.downloads,
    actions: ctx.actions,
    observed: ctx.observed,
    warmed,
  }
}

const STATUS_TEXT = Object.freeze({
  ok: "ready",
  created: "created",
  pinned: "pins written",
  unpinned: "setup writes its pins",
  missing: "missing; setup creates it",
  blocked: "missing; fix the problems above first",
  mismatch: "wrong pins; see the problems above",
  failed: "not created; see the problems above",
})

function formatSetup(result) {
  const label = result.check ? "setup --check" : "setup"
  const lines = [
    `release-check ${label}: ${result.ready ? "ready" : "not ready"}.`,
  ]
  if (result.problems.length > 0) {
    lines.push("Problems:")
    for (const item of result.problems) {
      lines.push(
        `- ${item.message}${item.command ? `\n  Run: ${item.command}` : ""}`,
      )
    }
  }
  lines.push("Devices:")
  for (const device of result.devices) {
    lines.push(`- ${device.id} (${device.name}): ${STATUS_TEXT[device.status]}`)
  }
  const pending = result.downloads.filter((download) => !download.installed)
  if (pending.length > 0) {
    lines.push("Downloads:")
    for (const download of pending) {
      lines.push(
        `- ${download.package}, about ${download.approxMb} MB: setup downloads it`,
      )
    }
  }
  if (result.notes.length > 0) {
    lines.push("Notes:")
    for (const note of result.notes) lines.push(`- ${note}`)
  }
  return lines.join("\n")
}

async function setupCommand(command, options = {}) {
  const out = options.out ?? console.log
  const result = await runSetup({
    ...options,
    check: Boolean(command.flags.check),
  })
  out(formatSetup(result))
  return result.ready ? EXIT.passed : EXIT.failed
}

module.exports = {
  runSetup,
  setupCommand,
}
