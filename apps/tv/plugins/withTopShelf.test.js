/* global require, jest, describe, it, expect, afterEach */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const os = require("os")
const path = require("path")
const plist = require("@expo/plist").default
const xcode = require(
  require.resolve("xcode", { paths: [require.resolve("expo/config-plugins")] }),
)
jest.mock("expo/config-plugins", () => ({
  withXcodeProject: (config, action) => {
    config.xcodeAction = action
    return config
  },
  withEntitlementsPlist: (config, action) => {
    config.entitlementsAction = action
    return config
  },
  withInfoPlist: (config, action) => {
    config.infoAction = action
    return config
  },
}))
const plugin = require("./withTopShelf")
const appConfig = require("../app.json").expo
const catalog = require("../top-shelf/catalog.json")
const originalEndpoint = process.env.TV_TOP_SHELF_FEED_URL
const originalLocalQA = process.env.TV_TOP_SHELF_FEED_LOCAL_QA
const temporary = []
afterEach(() => {
  for (const [key, value] of [
    ["TV_TOP_SHELF_FEED_URL", originalEndpoint],
    ["TV_TOP_SHELF_FEED_LOCAL_QA", originalLocalQA],
  ]) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  while (temporary.length)
    fs.rmSync(temporary.pop(), { recursive: true, force: true })
})
function projectFixture() {
  const project = xcode.project(
    path.join(__dirname, "../scripts/fixtures/topShelfProject.pbxproj"),
  )
  project.parseSync()
  return project
}
function configurations(project, target) {
  const objects = project.hash.project.objects
  return objects.XCConfigurationList[
    target.pbxNativeTarget.buildConfigurationList
  ].buildConfigurations.map(({ value }) => objects.XCBuildConfiguration[value])
}
const template = {
  NSExtension: { NSExtensionPointIdentifier: "com.apple.tv-top-shelf" },
  CustomExistingKey: "preserved",
  ForgeTopShelfFeedURL: "http://stale.example.test/old-feed",
  ForgeTopShelfAllowLocalFeed: true,
  NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
}

describe("native Top Shelf feed configuration", () => {
  it.each([undefined, ""])("is disabled without an endpoint (%p)", (url) => {
    const feed = plugin.feedConfiguration(url, "1")
    for (const debug of [true, false]) {
      const info = plugin.extensionInfo(template, appConfig, feed, debug)
      expect(info).not.toHaveProperty("ForgeTopShelfFeedURL")
      expect(info).not.toHaveProperty("NSAppTransportSecurity")
      expect(info.ForgeTopShelfAllowLocalFeed).toBe(false)
      expect(info.CustomExistingKey).toBe("preserved")
    }
    expect(template.ForgeTopShelfFeedURL).toBe(
      "http://stale.example.test/old-feed",
    )
  })

  it("preserves an HTTPS public feed in Debug and Release without local exceptions", () => {
    const feed = plugin.feedConfiguration(
      "https://public.example.test/tv/feed",
      "1",
    )
    for (const debug of [true, false]) {
      const info = plugin.extensionInfo(template, appConfig, feed, debug)
      expect(info.ForgeTopShelfFeedURL).toBe(
        "https://public.example.test/tv/feed",
      )
      expect(info.ForgeTopShelfAllowLocalFeed).toBe(false)
      expect(info).not.toHaveProperty("NSAppTransportSecurity")
    }
  })

  it.each([
    ["http://localhost:8098/top-shelf", "localhost"],
    ["http://127.0.0.1:8098/top-shelf", "127.0.0.1"],
    ["http://[::1]:8098/top-shelf", "::1"],
  ])(
    "isolates explicit %s QA transport to the Debug plist",
    (endpoint, host) => {
      const feed = plugin.feedConfiguration(endpoint, "1")
      const debug = plugin.extensionInfo(template, appConfig, feed, true)
      expect(debug.ForgeTopShelfFeedURL).toBe(endpoint)
      expect(debug.ForgeTopShelfAllowLocalFeed).toBe(true)
      expect(debug.NSAppTransportSecurity).toEqual({
        NSExceptionDomains: {
          [host]: {
            NSExceptionAllowsInsecureHTTPLoads: true,
            NSIncludesSubdomains: false,
          },
        },
      })
      const release = plugin.extensionInfo(template, appConfig, feed, false)
      expect(release).not.toHaveProperty("ForgeTopShelfFeedURL")
      expect(release).not.toHaveProperty("NSAppTransportSecurity")
      expect(release.ForgeTopShelfAllowLocalFeed).toBe(false)
    },
  )

  it.each([undefined, "0", "true", "yes"])(
    "rejects HTTP unless the QA flag is exactly1 (%p)",
    (flag) =>
      expect(() =>
        plugin.feedConfiguration("http://localhost/feed", flag),
      ).toThrow("TV_TOP_SHELF_FEED_LOCAL_QA=1"),
  )

  it.each([
    "http://public.example.test/feed",
    "http://192.168.1.2/feed",
    "http://127.1/feed",
    "http://127.0.0.2/feed",
    "http://0177.0.0.1/feed",
    "http://0x7f000001/feed",
    "http://localhost.example.test/feed",
    "http://localhost./feed",
    "http://[::ffff:127.0.0.1]/feed",
  ])("rejects nonexact loopback hosts even with QA opt-in: %s", (endpoint) => {
    expect(() => plugin.feedConfiguration(endpoint, "1")).toThrow(
      "exact loopback",
    )
  })

  it.each([
    "https://name:password@example.test/feed",
    "https://@example.test/feed",
    "http://user@localhost/feed",
    "https://public.example.test/feed?secret=do-not-print",
    "https://public.example.test/feed?",
    "https://public.example.test/feed#fragment",
    "https://public.example.test/feed#",
    "https://public.example.test/white space",
    "https:\\public.example.test/feed",
    "https:public.example.test/feed",
    "file:///tmp/feed.json",
    "not-a-url",
    "https://public.example.test/" + "a".repeat(2048),
    "https://public.example.test/" + "é".repeat(400),
  ])(
    "rejects unsafe or oversized config without echoing it: %s",
    (endpoint) => {
      let error
      try {
        plugin.feedConfiguration(endpoint, "1")
      } catch (caught) {
        error = caught
      }
      expect(error?.name).toBe("TopShelfFeedConfigurationError")
      expect(error.message).not.toContain(endpoint)
      expect(error.message).not.toContain("do-not-print")
    },
  )
})

describe("persistent native project wiring", () => {
  it("compiles both Swift sources once and selects Debug and sanitized Release Info plists", () => {
    const project = projectFixture()
    const target = plugin.addTopShelfTarget(project, appConfig)
    const objects = project.hash.project.objects
    const sourcePhase = target.pbxNativeTarget.buildPhases.find(
      ({ value }) => objects.PBXSourcesBuildPhase[value],
    )
    const sources = objects.PBXSourcesBuildPhase[sourcePhase.value].files.map(
      ({ value }) =>
        String(
          objects.PBXFileReference[objects.PBXBuildFile[value].fileRef].path,
        ).replace(/^"|"$/g, ""),
    )
    expect(sources.sort()).toEqual([
      "ContentProvider.swift",
      "TopShelfFeed.swift",
    ])
    for (const build of configurations(project, target)) {
      if (build.name === "Debug") {
        expect(build.buildSettings.INFOPLIST_FILE).toBe(
          '"ForgeTopShelf/Info-Debug.plist"',
        )
        expect(build.buildSettings.SWIFT_ACTIVE_COMPILATION_CONDITIONS).toBe(
          '"$(inherited) DEBUG"',
        )
      } else {
        expect(build.buildSettings.INFOPLIST_FILE).toBe(
          '"ForgeTopShelf/Info.plist"',
        )
      }
    }
    const once = project.writeSync()
    plugin.addTopShelfTarget(project, appConfig)
    expect(project.writeSync()).toBe(once)
  })

  it("registers the new source when upgrading an existing extension target", () => {
    const project = projectFixture()
    const target = plugin.addTopShelfTarget(project, appConfig)
    const group = Object.entries(project.hash.project.objects.PBXGroup).find(
      ([id, item]) => !id.endsWith("_comment") && item.name === "ForgeTopShelf",
    )
    project.removeSourceFile(
      "TopShelfFeed.swift",
      { target: target.uuid },
      group[0],
    )
    expect(project.hasFile("TopShelfFeed.swift")).toBe(false)
    const updated = plugin.addTopShelfTarget(project, appConfig)
    expect(updated.uuid).toBe(target.uuid)
    const objects = project.hash.project.objects
    const phase = updated.pbxNativeTarget.buildPhases.find(
      ({ value }) => objects.PBXSourcesBuildPhase[value],
    )
    expect(objects.PBXSourcesBuildPhase[phase.value].files).toHaveLength(2)
    const once = project.writeSync()
    plugin.addTopShelfTarget(project, appConfig)
    expect(project.writeSync()).toBe(once)
  })

  it("keeps existing Debug conditions while adding inherited DEBUG only once", () => {
    const project = projectFixture()
    const target = plugin.addTopShelfTarget(project, appConfig)
    const debug = configurations(project, target).find(
      (build) => build.name === "Debug",
    )
    debug.buildSettings.SWIFT_ACTIVE_COMPILATION_CONDITIONS = [
      "CUSTOM",
      '"$(inherited)"',
      "DEBUG",
    ]
    plugin.addTopShelfTarget(project, appConfig)
    expect(debug.buildSettings.SWIFT_ACTIVE_COMPILATION_CONDITIONS).toBe(
      '"$(inherited) CUSTOM DEBUG"',
    )
    const once = project.writeSync()
    plugin.addTopShelfTarget(project, appConfig)
    expect(project.writeSync()).toBe(once)
  })

  it("generates separate extension plists, copies Swift source and leaves app transport config unchanged", () => {
    process.env.TV_TOP_SHELF_FEED_URL = "http://127.0.0.1:8098/top-shelf"
    process.env.TV_TOP_SHELF_FEED_LOCAL_QA = "1"
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "top-shelf-plugin-test-"),
    )
    temporary.push(directory)
    const root = path.join(directory, "tv")
    const ios = path.join(root, "ios")
    const source = path.join(root, "top-shelf")
    fs.mkdirSync(source, { recursive: true })
    const fixtureFiles = [
      "ContentProvider.swift",
      "TopShelfFeed.swift",
      "Info.plist",
      "catalog.json",
      ...catalog.flatMap((item) => [
        item.imageName,
        ...(item.previewName ? [item.previewName] : []),
      ]),
    ]
    for (const file of fixtureFiles)
      fs.writeFileSync(
        path.join(source, file),
        file === "Info.plist" ? plist.build(template) : `fixture-${file}`,
      )
    const config = plugin(JSON.parse(JSON.stringify(appConfig)))
    const project = projectFixture()
    config.xcodeAction({
      modResults: project,
      modRequest: { projectRoot: root, platformProjectRoot: ios },
    })
    const destination = path.join(ios, "ForgeTopShelf")
    const debug = plist.parse(
      fs.readFileSync(path.join(destination, "Info-Debug.plist"), "utf8"),
    )
    const release = plist.parse(
      fs.readFileSync(path.join(destination, "Info.plist"), "utf8"),
    )
    expect(debug.ForgeTopShelfFeedURL).toBe(process.env.TV_TOP_SHELF_FEED_URL)
    expect(debug.ForgeTopShelfAllowLocalFeed).toBe(true)
    expect(release).not.toHaveProperty("ForgeTopShelfFeedURL")
    expect(release).not.toHaveProperty("NSAppTransportSecurity")
    expect(
      fs.readFileSync(path.join(destination, "TopShelfFeed.swift"), "utf8"),
    ).toBe("fixture-TopShelfFeed.swift")
    const appATS = {
      NSAllowsArbitraryLoads: false,
      NSExceptionDomains: { "existing.test": {} },
    }
    const appInfo = config.infoAction({
      modResults: { ExistingKey: true, NSAppTransportSecurity: appATS },
    }).modResults
    expect(appInfo).toEqual({
      ExistingKey: true,
      NSAppTransportSecurity: appATS,
      ForgeTopShelfAppGroup: `group.${appConfig.ios.bundleIdentifier}.topshelf`,
    })
    const firstProject = project.writeSync()
    config.xcodeAction({
      modResults: project,
      modRequest: { projectRoot: root, platformProjectRoot: ios },
    })
    expect(project.writeSync()).toBe(firstProject)
    expect(
      plist.parse(
        fs.readFileSync(path.join(destination, "Info-Debug.plist"), "utf8"),
      ),
    ).toEqual(debug)
  })
})
