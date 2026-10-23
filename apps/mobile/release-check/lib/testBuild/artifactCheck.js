"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global Buffer, module, require */
// The build check (KTD5, R17): reads a built `.app` or `.apk` and returns one
// finding per broken test setting. A finding names the setting and never
// carries the value it found.

const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { EXIT } = require("../contract")
const { CONFIG_DIR, LIST_FILES, readJson } = require("../lists")
const { run } = require("../proc")

const ADMIN_URL_KEY = "EXPO_PUBLIC_ADMIN_GRAPHQL_URL"
const DATADOG_TOKEN_KEY = "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN"
const DATADOG_TOKEN = /pub[0-9a-f]{32}/
const IOS_FIREBASE_KEY = "FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED"
const ANDROID_FIREBASE_KEY = "firebase_analytics_collection_deactivated"
const ANDROID_UPDATES_ENABLED = "expo.modules.updates.ENABLED"
const ANDROID_UPDATES_HEADERS =
  "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"
const CHANNEL_HEADER = "expo-channel-name"
const IOS_BUNDLE = "main.jsbundle"
const ANDROID_BUNDLE = "assets/index.android.bundle"
const ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"
const TOOL_ENV = { PATH: "/usr/bin:/bin" }
const TOOL_TIMEOUT_MS = 2 * 60_000
const TOOL_OUTPUT_BYTES = 32 * 1024 * 1024

class ArtifactCheckRefusal extends Error {
  constructor(message) {
    super(message)
    this.name = "ArtifactCheckRefusal"
  }
}

function finding(code, message, setting = null) {
  return { code, message, setting, file: null, deviceId: null }
}

function isKeyByte(byte) {
  return (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39)
}

// Hermes stores its strings with no separators, so a key can sit inside a
// longer run of [a-z0-9]; every window of the key's length is hashed.
function muxKeyDigestsIn(bundle, entries) {
  const byLength = new Map()
  for (const { sha256, length } of entries) {
    if (!byLength.has(length)) byLength.set(length, new Set())
    byLength.get(length).add(sha256)
  }
  const found = new Set()
  if (byLength.size === 0) return []
  let start = -1
  for (let index = 0; index <= bundle.length; index += 1) {
    if (index < bundle.length && isKeyByte(bundle[index])) {
      if (start < 0) start = index
      continue
    }
    if (start < 0) continue
    for (const [length, digests] of byLength) {
      for (let at = start; at + length <= index; at += 1) {
        const digest = crypto
          .createHash("sha256")
          .update(bundle.subarray(at, at + length))
          .digest("hex")
        if (digests.has(digest)) found.add(digest)
      }
    }
    start = -1
  }
  return [...found].sort()
}

/** The JavaScript bundle: the proxy URL, no Datadog token, no Mux Data key. */
function bundleFindings(bundle, settings, bundleName) {
  const findings = []
  const adminUrl = settings.testValue?.[ADMIN_URL_KEY]
  if (!adminUrl || !bundle.includes(Buffer.from(adminUrl, "utf8"))) {
    findings.push(
      finding(
        "ADMIN_URL_MISSING",
        `${bundleName} does not contain the test value of ${ADMIN_URL_KEY}, so the app would not call the read-only server.`,
        ADMIN_URL_KEY,
      ),
    )
  }
  if (DATADOG_TOKEN.test(bundle.toString("latin1"))) {
    findings.push(
      finding(
        "DATADOG_TOKEN_PRESENT",
        `${bundleName} contains a Datadog client token (pub plus 32 hex characters); ${DATADOG_TOKEN_KEY} must be unset in a test build.`,
        DATADOG_TOKEN_KEY,
      ),
    )
  }
  for (const digest of muxKeyDigestsIn(
    bundle,
    settings.muxDataEnvKeyDigests ?? [],
  )) {
    findings.push(
      finding(
        "MUX_KEY_PRESENT",
        `${bundleName} contains the Mux Data env key whose SHA-256 starts ${digest.slice(0, 12)} (muxDataEnvKeyDigests); a test build must carry no Mux Data key.`,
      ),
    )
  }
  return findings
}

function hasChannelHeader(headers) {
  if (typeof headers === "string") return headers.includes(CHANNEL_HEADER)
  return Object.keys(headers ?? {}).some(
    (name) => name.toLowerCase() === CHANNEL_HEADER,
  )
}

/** Info.plist and Expo.plist, as `plutil -convert json` gives them. */
function iosPlistFindings({ info, expo }) {
  const findings = []
  if (info?.[IOS_FIREBASE_KEY] !== true) {
    findings.push(
      finding(
        "FIREBASE_NOT_DEACTIVATED",
        `Info.plist does not set ${IOS_FIREBASE_KEY} to true, so Firebase Analytics could collect before the app starts.`,
      ),
    )
  }
  if (expo?.EXUpdatesEnabled !== false) {
    findings.push(
      finding(
        "UPDATES_ENABLED",
        "Expo.plist does not set EXUpdatesEnabled to false, so the build could load an over-the-air update.",
      ),
    )
  }
  if (hasChannelHeader(expo?.EXUpdatesRequestHeaders)) {
    findings.push(
      finding(
        "UPDATE_CHANNEL_PRESENT",
        `Expo.plist names an update channel (${CHANNEL_HEADER} in EXUpdatesRequestHeaders).`,
      ),
    )
  }
  return findings
}

function attributeName(raw) {
  const name = raw.replace(/\(0x[0-9a-f]+\)$/, "")
  const colon = name.lastIndexOf(":")
  if (colon < 0) return name
  const namespace = name.slice(0, colon)
  const local = name.slice(colon + 1)
  return namespace === ANDROID_NAMESPACE ? `android:${local}` : local
}

function attributeValue(raw) {
  const text = raw.replace(/ \(Raw: .*\)$/, "")
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text
}

/** `aapt2 dump xmltree` text as `{ name, attributes, children }` elements. */
function parseXmlTree(text) {
  const roots = []
  const stack = []
  let current = null
  for (const line of text.split("\n")) {
    const element = line.match(/^(\s*)E: (\S+) \(line=\d+\)\s*$/)
    if (element) {
      const indent = element[1].length
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop()
      }
      current = { name: element[2], attributes: {}, children: [], indent }
      if (stack.length > 0) stack[stack.length - 1].children.push(current)
      else roots.push(current)
      stack.push(current)
      continue
    }
    const attribute = line.match(/^\s*A: ([^=]+)=(.*)$/)
    if (attribute && current) {
      current.attributes[attributeName(attribute[1])] = attributeValue(
        attribute[2],
      )
    }
  }
  return roots
}

/** The merged AndroidManifest.xml of an APK, as parsed by parseXmlTree. */
function androidManifestFindings(roots) {
  const manifest = roots.find((node) => node.name === "manifest")
  const application = manifest?.children.find(
    (node) => node.name === "application",
  )
  const metaData = new Map(
    (application?.children ?? [])
      .filter((node) => node.name === "meta-data")
      .map((node) => [
        node.attributes["android:name"],
        node.attributes["android:value"],
      ]),
  )
  const findings = []
  if (application?.attributes["android:usesCleartextTraffic"] !== "true") {
    findings.push(
      finding(
        "CLEARTEXT_MISSING",
        "The merged manifest does not set android:usesCleartextTraffic to true, so the app could not reach the read-only server over http.",
      ),
    )
  }
  if (metaData.get(ANDROID_FIREBASE_KEY) !== "true") {
    findings.push(
      finding(
        "FIREBASE_NOT_DEACTIVATED",
        `The merged manifest does not set the ${ANDROID_FIREBASE_KEY} meta-data to true, so Firebase Analytics could collect before the app starts.`,
      ),
    )
  }
  if (metaData.get(ANDROID_UPDATES_ENABLED) !== "false") {
    findings.push(
      finding(
        "UPDATES_ENABLED",
        `The merged manifest does not set ${ANDROID_UPDATES_ENABLED} to false, so the build could load an over-the-air update.`,
      ),
    )
  }
  if (hasChannelHeader(metaData.get(ANDROID_UPDATES_HEADERS))) {
    findings.push(
      finding(
        "UPDATE_CHANNEL_PRESENT",
        `The merged manifest names an update channel (${CHANNEL_HEADER} in ${ANDROID_UPDATES_HEADERS}).`,
      ),
    )
  }
  return findings
}

function unreadable(file, detail) {
  return finding(
    "ARTIFACT_UNREADABLE",
    `The build check cannot read ${file} (${detail}), so it cannot prove the test settings.`,
  )
}

async function tool(command, args) {
  return run(command, args, {
    env: TOOL_ENV,
    timeoutMs: TOOL_TIMEOUT_MS,
    tailBytes: TOOL_OUTPUT_BYTES,
  })
}

async function readPlist(file) {
  const result = await tool("/usr/bin/plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    file,
  ])
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || "plutil failed")
  return JSON.parse(result.stdout)
}

async function checkIosApp(appDir, settings) {
  const findings = []
  const plists = {}
  for (const [name, file] of [
    ["info", "Info.plist"],
    ["expo", "Expo.plist"],
  ]) {
    try {
      plists[name] = await readPlist(path.join(appDir, file))
    } catch (error) {
      findings.push(unreadable(file, error.message))
    }
  }
  if (plists.info && plists.expo) findings.push(...iosPlistFindings(plists))
  try {
    const bundle = fs.readFileSync(path.join(appDir, IOS_BUNDLE))
    findings.push(...bundleFindings(bundle, settings, IOS_BUNDLE))
  } catch (error) {
    findings.push(unreadable(IOS_BUNDLE, error.message))
  }
  return findings
}

function versionParts(name) {
  return name.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0)
}

/** `aapt2` from the newest build-tools folder of the Android SDK. */
function newestAapt2(env = process.env) {
  const sdk =
    env.ANDROID_HOME ||
    env.ANDROID_SDK_ROOT ||
    path.join(os.homedir(), "Library/Android/sdk")
  const toolsDir = path.join(sdk, "build-tools")
  const versions = fs.existsSync(toolsDir)
    ? fs
        .readdirSync(toolsDir)
        .filter((name) => fs.existsSync(path.join(toolsDir, name, "aapt2")))
    : []
  versions.sort((a, b) => {
    const left = versionParts(a)
    const right = versionParts(b)
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      if ((left[i] ?? 0) !== (right[i] ?? 0)) {
        return (left[i] ?? 0) - (right[i] ?? 0)
      }
    }
    return 0
  })
  if (versions.length === 0) {
    throw new ArtifactCheckRefusal(
      `no aapt2 in ${toolsDir}; install the Android SDK build tools`,
    )
  }
  return path.join(toolsDir, versions[versions.length - 1], "aapt2")
}

async function checkAndroidApk(apkPath, settings, env) {
  const aapt2 = newestAapt2(env)
  const findings = []
  const dump = await tool(aapt2, [
    "dump",
    "xmltree",
    apkPath,
    "--file",
    "AndroidManifest.xml",
  ])
  if (dump.code === 0) {
    findings.push(...androidManifestFindings(parseXmlTree(dump.stdout)))
  } else {
    findings.push(
      unreadable("AndroidManifest.xml", dump.stderr.trim() || "aapt2 failed"),
    )
  }
  // proc.run decodes stdout as text, so the bundle goes through a file.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-apk-"))
  try {
    const unzip = await tool("/usr/bin/unzip", [
      "-q",
      "-o",
      apkPath,
      ANDROID_BUNDLE,
      "-d",
      outDir,
    ])
    const file = path.join(outDir, ANDROID_BUNDLE)
    if (unzip.code !== 0 || !fs.existsSync(file)) {
      findings.push(
        unreadable(ANDROID_BUNDLE, unzip.stderr.trim() || "not in the APK"),
      )
    } else {
      findings.push(
        ...bundleFindings(fs.readFileSync(file), settings, ANDROID_BUNDLE),
      )
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
  return findings
}

/** Checks one built `.app` folder or `.apk` file against the test settings. */
async function checkArtifact(appPath, { settings, env = process.env } = {}) {
  const stat = fs.existsSync(appPath) ? fs.statSync(appPath) : null
  if (stat?.isDirectory() && appPath.endsWith(".app")) {
    return {
      platform: "ios",
      artifact: appPath,
      findings: await checkIosApp(appPath, settings),
    }
  }
  if (stat?.isFile() && appPath.endsWith(".apk")) {
    return {
      platform: "android",
      artifact: appPath,
      findings: await checkAndroidApk(appPath, settings, env),
    }
  }
  throw new ArtifactCheckRefusal(
    `${appPath} is not a built .app folder or .apk file`,
  )
}

/** `check-build <app>`: exit 0 with no findings, 1 with findings, 2 refused. */
async function checkBuildCommand(command, options = {}) {
  const out = options.out ?? console.log
  const err = options.err ?? console.error
  const appPath = path.resolve(command.positionals[0])
  const settings =
    options.settings ?? readJson(path.join(CONFIG_DIR, LIST_FILES.testSettings))
  let result
  try {
    result = await checkArtifact(appPath, { settings, env: options.env })
  } catch (error) {
    if (!(error instanceof ArtifactCheckRefusal)) throw error
    err(`release-check refused: ${error.message}.`)
    return EXIT.refused
  }
  if (result.findings.length === 0) {
    out(`check-build passed: ${result.artifact} (${result.platform}).`)
    return EXIT.passed
  }
  out(
    `check-build failed with ${result.findings.length} finding(s) in ${result.artifact}:`,
  )
  for (const item of result.findings) out(`- ${item.code}: ${item.message}`)
  return EXIT.failed
}

module.exports = {
  ArtifactCheckRefusal,
  androidManifestFindings,
  bundleFindings,
  checkArtifact,
  checkBuildCommand,
  iosPlistFindings,
  parseXmlTree,
}
