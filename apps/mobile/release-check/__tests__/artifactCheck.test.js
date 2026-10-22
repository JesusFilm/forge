/* eslint-disable @typescript-eslint/no-require-imports */
/* global Buffer, describe, expect, it, require */
// KTD5, R17: the build check reads the built app and names each setting that
// breaks the test build, without the value it found (AE1, AE9).
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")

const { CONFIG_DIR, readJson } = require("../lib/lists")
const {
  androidManifestFindings,
  bundleFindings,
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
