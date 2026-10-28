/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, jest, require */
// Setup names each missing tool with the command that gets it, creates the
// five pinned devices, and never changes a runner device with wrong pins
// (R4, KTD15). `setup --check` creates nothing and downloads nothing.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { loadDeviceConfig, parseIni } = require("../lib/devices/inventory")
const { runSetup, setupCommand } = require("../lib/devices/setup")

const config = loadDeviceConfig()
const [SE, PRO_MAX, IPAD, PHONE, TABLET] = config.devices
const IMAGE_DIR = PHONE.image.split(";").join("/")
const MAESTRO_INSTALL = `curl -fsSL "https://get.maestro.mobile.dev" | MAESTRO_VERSION=${config.tools.maestro} bash`

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function writeExecutable(file, text = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, { mode: 0o755 })
}

function result(fields) {
  return {
    code: 0,
    timedOut: false,
    stopped: false,
    stdout: "",
    stderr: "",
    ...fields,
  }
}

function writeAvd(avdHome, name, settings) {
  const folder = path.join(avdHome, `${name}.avd`)
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(avdHome, `${name}.ini`), `path=${folder}\n`)
  const text = Object.entries(settings)
    .map(([key, value]) => `${key} = ${value}`)
    .join("\n")
  fs.writeFileSync(path.join(folder, "config.ini"), `${text}\n`)
  return path.join(folder, "config.ini")
}

// A Mac with Xcode, Java 17, the Android SDK, Maestro, and CocoaPods. `pod` is
// a version, null (not on PATH), "shim" (an rbenv shim with no gem), or
// "broken" (a pod outside rbenv that does not run).
function fakeMac({
  maestro = config.tools.maestro,
  pod = "1.16.2",
  imageInstalled = true,
  simulators = [],
  sdkInstall = "ok",
  avdCreate = "ok",
} = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-setup-"))
  tempDirs.push(home)
  const sdk = path.join(home, "sdk")
  for (const tool of [
    "platform-tools/adb",
    "emulator/emulator",
    "cmdline-tools/latest/bin/sdkmanager",
    "cmdline-tools/latest/bin/avdmanager",
  ]) {
    writeExecutable(path.join(sdk, tool))
  }
  fs.writeFileSync(
    path.join(sdk, "emulator/source.properties"),
    `Pkg.Revision=${config.pins.emulatorVersion}\n`,
  )
  fs.mkdirSync(path.join(sdk, "licenses"), { recursive: true })
  fs.writeFileSync(path.join(sdk, "licenses/android-sdk-license"), "hash\n")
  const installImage = () => {
    fs.mkdirSync(path.join(sdk, IMAGE_DIR), { recursive: true })
    fs.writeFileSync(
      path.join(sdk, IMAGE_DIR, "source.properties"),
      `Pkg.Revision=${config.pins.imageRevision}\n`,
    )
  }
  if (imageInstalled) installImage()
  const avdHome = path.join(home, ".android", "avd")
  fs.mkdirSync(avdHome, { recursive: true })
  const bin = path.join(home, "bin")
  writeExecutable(path.join(bin, "maestro"))
  const shims = path.join(home, ".rbenv", "shims")
  if (pod === "shim") writeExecutable(path.join(shims, "pod"))
  else if (pod !== null) writeExecutable(path.join(bin, "pod"))

  const calls = []
  const envs = {}
  const runtime = SE.runtime
  async function runChild(command, args, options = {}) {
    const line = [command, ...args].join(" ")
    calls.push(line)
    envs[line] = options.env
    if (command.endsWith("/pod")) {
      return pod === "shim" || pod === "broken"
        ? result({ code: 127, stderr: "rbenv: pod: command not found\n" })
        : result({ stdout: `${pod}\n` })
    }
    if (command === "/usr/bin/xcodebuild" && args[0] === "-version") {
      return result({ stdout: "Xcode 26.5\nBuild version 17F42\n" })
    }
    if (command === "/usr/bin/xcodebuild") return result({})
    if (args[0] === "simctl" && args[2] === "-j") {
      if (args[3] === "runtimes") {
        return result({
          stdout: JSON.stringify({
            runtimes: [
              {
                identifier: runtime,
                version: "26.5",
                buildversion: "23F77",
                isAvailable: true,
              },
            ],
          }),
        })
      }
      if (args[3] === "devicetypes") {
        const types = [SE, PRO_MAX, IPAD].map((device) => ({
          identifier: device.deviceType,
        }))
        return result({ stdout: JSON.stringify({ devicetypes: types }) })
      }
      const devices = {}
      for (const device of simulators) {
        devices[device.runtime] = [...(devices[device.runtime] ?? []), device]
      }
      return result({ stdout: JSON.stringify({ devices }) })
    }
    if (args[0] === "simctl" && args[1] === "create")
      return result({ stdout: `${args[2]}-UDID\n` })
    if (command === "/usr/libexec/java_home")
      return result({ stdout: "/jdk17\n" })
    if (command === "/jdk17/bin/java")
      return result({ stderr: 'openjdk version "17.0.13" 2024-10-15 LTS\n' })
    if (command.endsWith("/maestro")) return result({ stdout: `${maestro}\n` })
    if (command.endsWith("/avdmanager") && args[0] === "list")
      return result({ stdout: "pixel_7\npixel_tablet\n" })
    if (command.endsWith("/avdmanager") && args[0] === "create") {
      if (avdCreate === "question") {
        return result({
          code: 1,
          stdout: "Do you wish to create a custom hardware profile? [no] ",
        })
      }
      const name = args[args.indexOf("-n") + 1]
      const profile = args[args.indexOf("-d") + 1]
      writeAvd(avdHome, name, {
        "image.sysdir.1": `${IMAGE_DIR}/`,
        "hw.device.name": profile,
        "hw.ramSize": "1536M",
        "hw.keyboard": "yes",
      })
      return result({})
    }
    if (command.endsWith("/sdkmanager") && args[0] === "--install") {
      if (sdkInstall === "license") {
        return result({
          code: 1,
          stdout:
            "Accept? (y/N): Skipping following packages as the license is not accepted:\n  Google APIs ARM 64 v8a System Image\n",
        })
      }
      installImage()
      return result({})
    }
    if (command === "/bin/ps") return result({ stdout: "" })
    if (args[0] === "devices")
      return result({ stdout: "List of devices attached\n\n" })
    return result({})
  }
  const sourceEnv = {
    HOME: home,
    ANDROID_HOME: sdk,
    PATH: `${shims}:${bin}:/usr/bin:/bin`,
    RBENV_VERSION: "3.3.6",
  }
  return { avdHome, bin, calls, envs, home, runChild, sdk, shims, sourceEnv }
}

function simulator(device, runtime) {
  return {
    name: device.name,
    udid: `${device.id}-OLD`,
    state: "Shutdown",
    isAvailable: true,
    deviceTypeIdentifier: device.deviceType,
    runtime,
  }
}

const CREATES =
  /simctl create|avdmanager create|sdkmanager --install|simctl delete|avdmanager delete/

describe("setup --check", () => {
  it("names the Maestro version and the upgrade command, and creates nothing", async () => {
    const mac = fakeMac({ maestro: "2.4.0", imageInstalled: false })
    const out = jest.fn()

    const exitCode = await setupCommand(
      { flags: { check: true } },
      { runChild: mac.runChild, sourceEnv: mac.sourceEnv, config, out },
    )

    expect(exitCode).toBe(1)
    const text = out.mock.calls[0][0]
    expect(text).toContain(
      `Maestro 2.4.0 is installed at ${path.join(mac.home, "bin", "maestro")}, and the runner needs ${config.tools.maestro}.`,
    )
    expect(text).toContain(`Run: ${MAESTRO_INSTALL}`)
    expect(text).toContain(
      `${PHONE.image}, about ${config.downloads.androidImageMb} MB: setup downloads it`,
    )
    expect(mac.calls.filter((call) => CREATES.test(call))).toEqual([])
    expect(fs.readdirSync(mac.avdHome)).toEqual([])
    expect(fs.existsSync(path.join(mac.sdk, IMAGE_DIR))).toBe(false)
  })

  it("names CocoaPods and its install command when pod is not on PATH", async () => {
    const mac = fakeMac({ pod: null })
    const out = jest.fn()

    const exitCode = await setupCommand(
      { flags: { check: true } },
      { runChild: mac.runChild, sourceEnv: mac.sourceEnv, config, out },
    )

    expect(exitCode).toBe(1)
    const text = out.mock.calls[0][0]
    expect(text).toContain(
      "CocoaPods is not installed; the iOS build runs pod install.",
    )
    expect(text).toContain("Run: brew install cocoapods")
  })

  it("runs pod with the build's PATH and Ruby settings, and names the gem install for an rbenv shim with no gem", async () => {
    const mac = fakeMac({ pod: "shim" })

    const setup = await runSetup({
      runChild: mac.runChild,
      sourceEnv: mac.sourceEnv,
      config,
      check: true,
    })

    const pod = path.join(mac.shims, "pod")
    expect(setup.problems).toEqual([
      {
        code: "COCOAPODS_MISSING",
        message: `${pod} --version printed no version; the rbenv Ruby that it runs has no CocoaPods gem.`,
        command: "gem install cocoapods && rbenv rehash",
        deviceId: null,
      },
    ])
    expect(mac.envs[`${pod} --version`]).toMatchObject({
      PATH: mac.sourceEnv.PATH,
      RBENV_VERSION: "3.3.6",
      LANG: "en_US.UTF-8",
    })
    expect(setup.observed.cocoapods).toBeNull()
  })

  it("names a pod outside rbenv that does not run, with no install command", async () => {
    const mac = fakeMac({ pod: "broken" })

    const setup = await runSetup({
      runChild: mac.runChild,
      sourceEnv: mac.sourceEnv,
      config,
      check: true,
    })

    const pod = path.join(mac.bin, "pod")
    expect(setup.problems).toEqual([
      {
        code: "COCOAPODS_MISSING",
        message: `${pod} --version printed no version; reinstall CocoaPods there, or remove it from PATH.`,
        command: null,
        deviceId: null,
      },
    ])
  })

  it.each([
    ["1.16.2", "1.16.2"],
    ["a prerelease", "1.17.0.beta.1"],
  ])(
    "records the CocoaPods version when pod answers with %s",
    async (_name, pod) => {
      const mac = fakeMac({ pod })

      const setup = await runSetup({
        runChild: mac.runChild,
        sourceEnv: mac.sourceEnv,
        config,
        check: true,
      })

      expect(setup.problems).toEqual([])
      expect(setup.observed.cocoapods).toBe(pod)
    },
  )
})

describe("setup", () => {
  it("creates the five devices with their pins and downloads the image", async () => {
    const mac = fakeMac({ imageInstalled: false })
    const warmBuildCaches = jest.fn(async () => ({ ok: true }))

    const setup = await runSetup({
      runChild: mac.runChild,
      sourceEnv: mac.sourceEnv,
      config,
      warmBuildCaches,
    })

    expect(setup.problems).toEqual([])
    expect(setup.ready).toBe(true)
    expect(mac.calls.filter((call) => CREATES.test(call))).toEqual([
      `${mac.sdk}/cmdline-tools/latest/bin/sdkmanager --install ${PHONE.image}`,
      `/usr/bin/xcrun simctl create ${SE.name} ${SE.deviceType} ${SE.runtime}`,
      `/usr/bin/xcrun simctl create ${PRO_MAX.name} ${PRO_MAX.deviceType} ${PRO_MAX.runtime}`,
      `/usr/bin/xcrun simctl create ${IPAD.name} ${IPAD.deviceType} ${IPAD.runtime}`,
      `${mac.sdk}/cmdline-tools/latest/bin/avdmanager create avd -n ${PHONE.avd} -k ${PHONE.image} -d ${PHONE.profile}`,
      `${mac.sdk}/cmdline-tools/latest/bin/avdmanager create avd -n ${TABLET.avd} -k ${TABLET.image} -d ${TABLET.profile}`,
    ])
    for (const avd of [PHONE.avd, TABLET.avd]) {
      const settings = parseIni(
        fs.readFileSync(
          path.join(mac.avdHome, `${avd}.avd`, "config.ini"),
          "utf8",
        ),
      )
      expect(settings).toMatchObject({
        "hw.ramSize": String(config.pins.memoryMb),
        "hw.keyboard": "no",
        "hw.gpu.enabled": "yes",
        "hw.gpu.mode": config.pins.gpuMode,
      })
    }
    expect(warmBuildCaches).toHaveBeenCalledTimes(1)
  })

  it("names a Forge RC simulator with the wrong runtime and does not change it", async () => {
    const wrong = "com.apple.CoreSimulator.SimRuntime.iOS-18-6"
    const mac = fakeMac({ simulators: [simulator(SE, wrong)] })

    const setup = await runSetup({
      runChild: mac.runChild,
      sourceEnv: mac.sourceEnv,
      config,
    })

    expect(setup.ready).toBe(false)
    expect(setup.problems).toEqual([
      {
        code: "DEVICE_PIN_MISMATCH",
        message: `${SE.name} exists, but its runtime is ${wrong}, and the pin is ${SE.runtime}; setup does not change it. Delete it, then run setup again.`,
        command: "xcrun simctl delete iphone-se-OLD",
        deviceId: "iphone-se",
      },
    ])
    expect(
      mac.calls.some((call) => call.includes(`simctl create ${SE.name} `)),
    ).toBe(false)
    expect(mac.calls.some((call) => call.includes("simctl delete"))).toBe(false)
    expect(
      mac.calls.some((call) => call.includes(`simctl create ${PRO_MAX.name} `)),
    ).toBe(true)
  })

  it("names a forge_rc AVD with the wrong image and leaves its config.ini as it is", async () => {
    const mac = fakeMac()
    const wrongImage =
      "system-images/android-35/google_apis_playstore/arm64-v8a/"
    const file = writeAvd(mac.avdHome, PHONE.avd, {
      "image.sysdir.1": wrongImage,
      "hw.device.name": PHONE.profile,
    })
    const before = fs.readFileSync(file, "utf8")

    const setup = await runSetup({
      runChild: mac.runChild,
      sourceEnv: mac.sourceEnv,
      config,
    })

    expect(setup.problems.map((item) => item.message)).toEqual([
      `${PHONE.avd} exists, but its image is ${wrongImage}, and the pin is ${IMAGE_DIR}/; setup does not change it. Delete it, then run setup again.`,
    ])
    expect(fs.readFileSync(file, "utf8")).toBe(before)
  })

  it("prints the license command when sdkmanager asks to accept a license", async () => {
    const mac = fakeMac({ imageInstalled: false, sdkInstall: "license" })

    const setup = await runSetup({
      runChild: mac.runChild,
      sourceEnv: mac.sourceEnv,
      config,
    })

    expect(setup.problems).toContainEqual({
      code: "ANDROID_SDK_LICENSE",
      message:
        "The Android SDK licenses are not accepted; run this command and accept each license.",
      command: `"${mac.sdk}/cmdline-tools/latest/bin/sdkmanager" --licenses`,
      deviceId: null,
    })
    expect(mac.calls.some((call) => call.includes("avdmanager create"))).toBe(
      false,
    )
  })

  it("prints the create command when avdmanager asks about a hardware profile", async () => {
    const mac = fakeMac({ avdCreate: "question" })

    const setup = await runSetup({
      runChild: mac.runChild,
      sourceEnv: mac.sourceEnv,
      config,
    })

    expect(
      setup.problems.filter((item) => item.code === "AVD_PROFILE_QUESTION"),
    ).toEqual([
      expect.objectContaining({
        deviceId: "android-phone",
        command: `"${mac.sdk}/cmdline-tools/latest/bin/avdmanager" create avd -n ${PHONE.avd} -k "${PHONE.image}" -d ${PHONE.profile}`,
      }),
      expect.objectContaining({ deviceId: "android-tablet" }),
    ])
  })
})
