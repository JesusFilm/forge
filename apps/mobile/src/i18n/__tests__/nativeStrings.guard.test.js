// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs, path, and child_process to run the generator.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
const childProcess = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

// Guard (feat-627): iOS reads the Local Network sentence from Info.plist or a
// per-language InfoPlist.strings, never from the JS catalogs.
const MOBILE_DIR = path.join(__dirname, "..", "..", "..")
const SCRIPT = path.join(
  MOBILE_DIR,
  "scripts",
  "i18n",
  "generate-native-strings.mjs",
)
const APP_JSON = path.join(MOBILE_DIR, "app.json")
const EN_CATALOG = path.join(MOBILE_DIR, "messages", "en.json")

const PLIST_KEY = "NSLocalNetworkUsageDescription"
const ENGLISH =
  "The app uses your local network to find Cast devices, so you can play videos on your TV."

const tempDirs = []
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"))

function runGenerator(args) {
  return childProcess.spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
  })
}

const catalog = (sentence) => ({
  NativePermissions: { localNetworkUsageDescription: sentence },
})

/** A mobile-like dir: catalogs, and an app.json with the English. */
function fixture(sentences) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-strings-"))
  tempDirs.push(root)
  const messagesDir = path.join(root, "messages")
  const outDir = path.join(root, "i18n", "native")
  fs.mkdirSync(messagesDir)
  fs.mkdirSync(outDir, { recursive: true })
  for (const [tag, sentence] of Object.entries({ en: ENGLISH, ...sentences })) {
    fs.writeFileSync(
      path.join(messagesDir, `${tag}.json`),
      JSON.stringify(catalog(sentence)),
    )
  }
  const appJson = path.join(root, "app.json")
  const expo = { name: "x", ios: { infoPlist: { [PLIST_KEY]: ENGLISH } } }
  fs.writeFileSync(appJson, `${JSON.stringify({ expo }, null, 2)}\n`)
  const args = [
    `--messages-dir=${messagesDir}`,
    `--app-json=${appJson}`,
    `--out-dir=${outDir}`,
  ]
  return { messagesDir, outDir, appJson, args }
}

const outFiles = (outDir) => fs.readdirSync(outDir).sort()

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe("iOS InfoPlist.strings locale files (feat-627)", () => {
  it("--check passes on the committed files and app.json", () => {
    const result = runGenerator(["--check"])
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
  })

  it("keeps the English catalog text equal to the Info.plist text", () => {
    const english =
      readJson(EN_CATALOG).NativePermissions.localNetworkUsageDescription
    expect(readJson(APP_JSON).expo.ios.infoPlist[PLIST_KEY]).toBe(english)
  })

  it("writes one iOS-only file per translated catalog and lists it in app.json", () => {
    const { outDir, appJson, args } = fixture({
      es: "La app usa tu red local para encontrar dispositivos Cast.",
      "zh-Hans": "此应用使用你的本地网络查找 Cast 设备。",
      de: ENGLISH,
    })
    expect(runGenerator(args).status).toBe(0)

    // en and de (pending or English-only: English text) use Info.plist.
    expect(outFiles(outDir)).toEqual(["es.json", "zh-Hans.json"])
    expect(readJson(path.join(outDir, "es.json"))).toEqual({
      ios: {
        [PLIST_KEY]:
          "La app usa tu red local para encontrar dispositivos Cast.",
      },
    })
    const { expo } = readJson(appJson)
    expect(expo.locales).toEqual({
      es: "./i18n/native/es.json",
      "zh-Hans": "./i18n/native/zh-Hans.json",
    })
    expect(expo.ios.infoPlist[PLIST_KEY]).toBe(ENGLISH)
    expect(runGenerator([...args, "--check"]).status).toBe(0)
  })

  it.each([
    [
      "a changed translation",
      ({ messagesDir }) => {
        fs.writeFileSync(
          path.join(messagesDir, "es.json"),
          JSON.stringify(catalog("Otra frase para la red local.")),
        )
      },
      "es.json",
    ],
    [
      "a stale locale file",
      ({ outDir }) => {
        fs.writeFileSync(path.join(outDir, "fr.json"), "{}\n")
      },
      "fr.json",
    ],
    [
      "app.json without the locales entry",
      ({ appJson }) => {
        const config = readJson(appJson)
        delete config.expo.locales
        fs.writeFileSync(appJson, `${JSON.stringify(config, null, 2)}\n`)
      },
      "app.json",
    ],
  ])("--check fails on %s, and a run repairs it", (_, drift, named) => {
    const dirs = fixture({ es: "La app usa tu red local." })
    expect(runGenerator(dirs.args).status).toBe(0)
    drift(dirs)

    const result = runGenerator([...dirs.args, "--check"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(named)

    expect(runGenerator(dirs.args).status).toBe(0)
    expect(runGenerator([...dirs.args, "--check"]).status).toBe(0)
    expect(outFiles(dirs.outDir)).toEqual(["es.json"])
  })

  // Expo writes each value between quotes in InfoPlist.strings with no
  // escaping, so these characters would break the file.
  it.each([
    ["a double quote", 'La app usa tu "red local".'],
    ["a backslash", "La app usa tu red\\local."],
    ["a line break", "La app usa tu red local.\nY tu TV."],
  ])("refuses a translation with %s and writes nothing", (_, sentence) => {
    const { outDir, appJson, args } = fixture({ es: sentence })
    const before = fs.readFileSync(appJson, "utf8")
    const result = runGenerator(args)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("InfoPlist.strings for es:")
    expect(outFiles(outDir)).toEqual([])
    expect(fs.readFileSync(appJson, "utf8")).toBe(before)
  })

  // The premise of the `ios` wrapper, read through the plugin that prebuild
  // runs: top-level keys would also become Android string resources.
  it("makes the installed Expo locale resolver give the key to iOS only", async () => {
    const { getResolvedLocalesAsync } = require(
      require.resolve("@expo/config-plugins/build/utils/locales", {
        paths: [require.resolve("expo/package.json")],
      }),
    )
    const { locales } = readJson(APP_JSON).expo
    const es = readJson(path.join(MOBILE_DIR, "messages", "es.json"))
    expect(locales.es).toBe("./i18n/native/es.json")

    const ios = await getResolvedLocalesAsync(MOBILE_DIR, locales, "ios")
    expect(ios.localesMap.es).toEqual({
      [PLIST_KEY]: es.NativePermissions.localNetworkUsageDescription,
    })
    const android = await getResolvedLocalesAsync(
      MOBILE_DIR,
      locales,
      "android",
    )
    expect(Object.values(android.localesMap)).toEqual(
      Object.values(locales).map(() => ({})),
    )
  })
})
