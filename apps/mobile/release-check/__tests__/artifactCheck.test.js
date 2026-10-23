/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, Buffer, describe, expect, it, require */
// KTD5, R17: the build check reads the built app and names each setting that
// breaks the test build, without the value it found (AE1, AE9).
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { CONFIG_DIR, readJson } = require("../lib/lists")
const {
  androidManifestFindings,
  bundleFindings,
  checkArtifact,
  checkBuildCommand,
  iosPlistFindings,
  parseXmlTree,
} = require("../lib/testBuild/artifactCheck")

const FIXTURES = path.join(__dirname, "fixtures", "test-build")
const committed = readJson(path.join(CONFIG_DIR, "test-settings.json"))
const PROXY_URL = committed.testValue.EXPO_PUBLIC_ADMIN_GRAPHQL_URL

// Built at run time, so no secret-shaped text is in the repo.
const MUX_KEY = ["k3y9", "mux0", "env7", "abcd", "efgh", "ij"].join("")
const DATADOG_TOKEN = `pub${"0f".repeat(16)}`

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex")
}

function settingsWithMuxKey(key) {
  return {
    ...committed,
    muxDataEnvKeyDigests: [{ sha256: sha256(key), length: key.length }],
  }
}

// A Hermes string table: the strings follow each other with no separator.
function stringTable(...strings) {
  return Buffer.concat([
    Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0x62, 0x00, 0x00, 0x00]),
    ...strings.map((text) => Buffer.from(text, "utf8")),
  ])
}

function codes(findings) {
  return findings.map((item) => item.code)
}

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8")
}

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-artifact-"))
  tempDirs.push(dir)
  return dir
}

function toolResult(code, stdout = "", stderr = "") {
  return { code, stdout, stderr }
}

describe("the bundle check", () => {
  it("passes a bundle with the proxy URL and the code's own admin defaults", () => {
    const bundle = stringTable(
      "VideoThumbnails",
      PROXY_URL,
      "http://localhost:3003/api/graphql",
      "admin.jesusfilm.org",
      "10.0.2.2",
    )
    expect(bundleFindings(bundle, committed, "main.jsbundle")).toEqual([])
  })

  it("fails a bundle without the proxy URL", () => {
    const bundle = stringTable(
      "http://localhost:3003/api/graphql",
      "admin.jesusfilm.org",
    )
    expect(bundleFindings(bundle, committed, "main.jsbundle")).toEqual([
      expect.objectContaining({
        code: "ADMIN_URL_MISSING",
        setting: "EXPO_PUBLIC_ADMIN_GRAPHQL_URL",
      }),
    ])
  })

  it("names the Datadog client token setting and leaves out the token (AE1)", () => {
    const bundle = stringTable(PROXY_URL, "Bearer", DATADOG_TOKEN, "Home")
    const findings = bundleFindings(bundle, committed, "main.jsbundle")

    expect(findings).toEqual([
      {
        code: "DATADOG_TOKEN_PRESENT",
        message: expect.stringContaining("EXPO_PUBLIC_DATADOG_CLIENT_TOKEN"),
        setting: "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN",
        file: null,
        deviceId: null,
      },
    ])
    expect(JSON.stringify(findings)).not.toContain(DATADOG_TOKEN)
  })

  it("names a Mux Data key whose digest is listed and leaves out the key", () => {
    const bundle = stringTable(PROXY_URL, "Mux", MUX_KEY, "Player")
    const findings = bundleFindings(
      bundle,
      settingsWithMuxKey(MUX_KEY),
      "main.jsbundle",
    )

    expect(codes(findings)).toEqual(["MUX_KEY_PRESENT"])
    expect(findings[0].message).toContain("Mux Data env key")
    expect(JSON.stringify(findings)).not.toContain(MUX_KEY)
  })

  it("finds a Mux Data key between other [a-z0-9] bytes with no separator", () => {
    const bundle = stringTable(PROXY_URL, "videoid", MUX_KEY, "2024hls")
    expect(
      codes(
        bundleFindings(bundle, settingsWithMuxKey(MUX_KEY), "main.jsbundle"),
      ),
    ).toEqual(["MUX_KEY_PRESENT"])
  })

  it("passes a bundle that has only part of a listed Mux Data key", () => {
    const bundle = stringTable(PROXY_URL, MUX_KEY.slice(0, -1), "Z")
    expect(
      bundleFindings(bundle, settingsWithMuxKey(MUX_KEY), "main.jsbundle"),
    ).toEqual([])
  })
})

describe("the iOS plist check", () => {
  const info = JSON.parse(readFixture("Info.plist.json"))
  const expo = JSON.parse(readFixture("Expo.plist.json"))

  it("passes the plists of the spike build", () => {
    expect(iosPlistFindings({ info, expo })).toEqual([])
  })

  it("names the missing Firebase Analytics key (AE9)", () => {
    const withoutKey = { ...info }
    delete withoutKey.FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED

    const findings = iosPlistFindings({ info: withoutKey, expo })
    expect(codes(findings)).toEqual(["FIREBASE_NOT_DEACTIVATED"])
    expect(findings[0].message).toContain(
      "FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED",
    )
  })

  it("fails an Expo.plist with EXUpdatesEnabled true", () => {
    expect(
      codes(
        iosPlistFindings({ info, expo: { ...expo, EXUpdatesEnabled: true } }),
      ),
    ).toEqual(["UPDATES_ENABLED"])
  })

  it("fails an Expo.plist with an update channel header", () => {
    const withChannel = {
      ...expo,
      EXUpdatesRequestHeaders: { "expo-channel-name": "production" },
    }
    expect(codes(iosPlistFindings({ info, expo: withChannel }))).toEqual([
      "UPDATE_CHANNEL_PRESENT",
    ])
  })
})

describe("the Android manifest check", () => {
  const manifest = readFixture("AndroidManifest.xmltree.txt")

  function findingsFor(text) {
    return codes(androidManifestFindings(parseXmlTree(text)))
  }

  it("passes the merged manifest of the spike build", () => {
    expect(findingsFor(manifest)).toEqual([])
  })

  it("fails a manifest without cleartext traffic", () => {
    expect(
      findingsFor(
        manifest.replace(
          "usesCleartextTraffic(0x010104ec)=true",
          "debuggable(0x0101000f)=false",
        ),
      ),
    ).toEqual(["CLEARTEXT_MISSING"])
  })

  it("fails a manifest with updates on", () => {
    const enabled = manifest.replace(
      /("expo\.modules\.updates\.ENABLED".*\n.*value\(0x01010024\)=)false/,
      "$1true",
    )
    expect(enabled).not.toBe(manifest)
    expect(findingsFor(enabled)).toEqual(["UPDATES_ENABLED"])
  })

  it("names the Firebase meta-data when only a nested element carries it", () => {
    const moved = manifest
      .replace(
        '"firebase_analytics_collection_deactivated"',
        '"firebase_analytics_collection_moved"',
      )
      .replace(
        '"expo.modules.clipboard.CLIPBOARD_FILE_PROVIDER_PATHS"',
        '"firebase_analytics_collection_deactivated"',
      )
    const findings = androidManifestFindings(parseXmlTree(moved))
    expect(codes(findings)).toEqual(["FIREBASE_NOT_DEACTIVATED"])
    expect(findings[0].message).toContain(
      "firebase_analytics_collection_deactivated",
    )
  })

  it("fails a manifest with an update channel header", () => {
    const header = [
      "          E: meta-data (line=140)",
      '            A: http://schemas.android.com/apk/res/android:name(0x01010003)="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" (Raw: "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY")',
      '            A: http://schemas.android.com/apk/res/android:value(0x01010024)="{"expo-channel-name":"production"}" (Raw: "{"expo-channel-name":"production"}")',
    ].join("\n")
    const withChannel = manifest.replace(
      "          E: activity (line=147)",
      `${header}\n          E: activity (line=147)`,
    )
    expect(findingsFor(withChannel)).toEqual(["UPDATE_CHANNEL_PRESENT"])
  })
})

describe("checkArtifact on a built iOS app", () => {
  // plutil also reads a JSON plist, so the JSON fixtures serve as the plists.
  function iosApp({ bundle = stringTable(PROXY_URL), without = [] } = {}) {
    const appDir = path.join(tempDir(), "forgewatch.app")
    fs.mkdirSync(appDir)
    for (const name of ["Info.plist", "Expo.plist"]) {
      fs.copyFileSync(
        path.join(FIXTURES, `${name}.json`),
        path.join(appDir, name),
      )
    }
    fs.writeFileSync(path.join(appDir, "main.jsbundle"), bundle)
    for (const name of without) fs.rmSync(path.join(appDir, name))
    return appDir
  }

  async function jsonPlutil(_command, args) {
    const file = args[args.length - 1]
    if (!fs.existsSync(file)) return toolResult(1, "", `${file}: no such file`)
    return toolResult(0, fs.readFileSync(file, "utf8"))
  }

  function check(appDir) {
    return checkArtifact(appDir, { settings: committed, runChild: jsonPlutil })
  }

  it("passes a built app with the test settings", async () => {
    const appDir = iosApp()
    expect(await check(appDir)).toEqual({
      platform: "ios",
      artifact: appDir,
      findings: [],
    })
  })

  it("names main.jsbundle when the app has no bundle", async () => {
    const { findings } = await check(iosApp({ without: ["main.jsbundle"] }))
    expect(codes(findings)).toEqual(["ARTIFACT_UNREADABLE"])
    expect(findings[0].message).toContain("cannot read main.jsbundle")
  })

  it("names Info.plist when plutil cannot read it and skips the plist check", async () => {
    const { findings } = await check(iosApp({ without: ["Info.plist"] }))
    expect(codes(findings)).toEqual(["ARTIFACT_UNREADABLE"])
    expect(findings[0].message).toContain("cannot read Info.plist")
  })

  it("fails a bundle with a Datadog client token and leaves out the token", async () => {
    const result = await check(
      iosApp({ bundle: stringTable(PROXY_URL, DATADOG_TOKEN) }),
    )
    expect(codes(result.findings)).toEqual(["DATADOG_TOKEN_PRESENT"])
    expect(JSON.stringify(result)).not.toContain(DATADOG_TOKEN)
  })

  const withPlutil = fs.existsSync("/usr/bin/plutil") ? it : it.skip

  withPlutil("reads the plists with the real plutil", async () => {
    const appDir = iosApp()
    expect(await checkArtifact(appDir, { settings: committed })).toEqual({
      platform: "ios",
      artifact: appDir,
      findings: [],
    })
  })

  withPlutil(
    "names Info.plist when the real plutil cannot open it",
    async () => {
      const { findings } = await checkArtifact(
        iosApp({ without: ["Info.plist"] }),
        { settings: committed },
      )
      expect(codes(findings)).toEqual(["ARTIFACT_UNREADABLE"])
      expect(findings[0].message).toContain("cannot read Info.plist")
    },
  )
})

describe("checkArtifact on a built Android app", () => {
  const ANDROID_BUNDLE = "assets/index.android.bundle"

  function androidTools({
    aapt2 = toolResult(0, readFixture("AndroidManifest.xmltree.txt")),
    unzip = toolResult(0),
    bundle = stringTable(PROXY_URL),
  }) {
    return async (command, args) => {
      if (path.basename(command) === "aapt2") return aapt2
      if (unzip.code === 0 && bundle !== null) {
        const file = path.join(args[args.indexOf("-d") + 1], ANDROID_BUNDLE)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, bundle)
      }
      return unzip
    }
  }

  async function check(tools = {}) {
    const sdk = tempDir()
    fs.mkdirSync(path.join(sdk, "build-tools", "36.0.0"), { recursive: true })
    fs.writeFileSync(path.join(sdk, "build-tools", "36.0.0", "aapt2"), "")
    const apk = path.join(tempDir(), "forgewatch.apk")
    fs.writeFileSync(apk, "PK")
    const result = await checkArtifact(apk, {
      settings: committed,
      env: { ANDROID_HOME: sdk },
      runChild: androidTools(tools),
    })
    return { apk, result }
  }

  it("passes a built APK with the test settings", async () => {
    const { apk, result } = await check()
    expect(result).toEqual({ platform: "android", artifact: apk, findings: [] })
  })

  it("names AndroidManifest.xml when aapt2 fails and still checks the bundle", async () => {
    const { result } = await check({
      aapt2: toolResult(1, "", "ERROR: not a valid APK"),
    })
    expect(codes(result.findings)).toEqual(["ARTIFACT_UNREADABLE"])
    expect(result.findings[0].message).toContain(
      "cannot read AndroidManifest.xml (ERROR: not a valid APK)",
    )
  })

  it("names the bundle when unzip fails", async () => {
    const { result } = await check({
      unzip: toolResult(9, "", "End-of-central-directory signature not found."),
    })
    expect(codes(result.findings)).toEqual(["ARTIFACT_UNREADABLE"])
    expect(result.findings[0].message).toContain(
      `cannot read ${ANDROID_BUNDLE} (End-of-central-directory signature not found.)`,
    )
  })

  it("names the bundle when the APK has none", async () => {
    const { result } = await check({ bundle: null })
    expect(codes(result.findings)).toEqual(["ARTIFACT_UNREADABLE"])
    expect(result.findings[0].message).toContain(
      `cannot read ${ANDROID_BUNDLE} (not in the APK)`,
    )
  })

  it("fails a bundle with a Datadog client token and leaves out the token", async () => {
    const { result } = await check({
      bundle: stringTable(PROXY_URL, DATADOG_TOKEN),
    })
    expect(codes(result.findings)).toEqual(["DATADOG_TOKEN_PRESENT"])
    expect(JSON.stringify(result)).not.toContain(DATADOG_TOKEN)
  })
})

describe("check-build", () => {
  it.each([
    ["a path that does not exist", "/no/such/forgewatch.app"],
    ["a file that is not a built app", path.join(FIXTURES, "Info.plist.json")],
  ])("refuses %s with exit 2", async (_label, target) => {
    const errors = []
    const exitCode = await checkBuildCommand(
      { positionals: [target], flags: {} },
      { out: () => {}, err: (line) => errors.push(line) },
    )
    expect(exitCode).toBe(2)
    expect(errors[0]).toContain("is not a built .app folder or .apk file")
  })
})
