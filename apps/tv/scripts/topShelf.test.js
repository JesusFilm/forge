/* global require, describe, it, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const { URL } = require("url")
const xcode = require(
  require.resolve("xcode", { paths: [require.resolve("expo/config-plugins")] }),
)
const withTopShelf = require("../plugins/withTopShelf")
const catalog = require("../top-shelf/catalog.json")
const config = require("../app.json").expo

function projectFixture() {
  const project = xcode.project(
    path.join(__dirname, "fixtures/topShelfProject.pbxproj"),
  )
  project.parseSync()
  return project
}

describe("Apple TV Top Shelf", () => {
  it("embeds one tvOS extension with an explicit app dependency and all resources", () => {
    const project = projectFixture()
    const target = withTopShelf.addTopShelfTarget(project, config)
    const objects = project.hash.project.objects
    const main = project.getFirstTarget().firstTarget
    expect(main.dependencies).toHaveLength(1)
    expect(objects.PBXTargetDependency[main.dependencies[0].value].target).toBe(
      target.uuid,
    )
    const embed = objects.PBXCopyFilesBuildPhase[main.buildPhases[0].value]
    expect(String(embed.dstSubfolderSpec)).toBe("13")
    expect(
      embed.files.some(
        (file) =>
          objects.PBXBuildFile[file.value].fileRef ===
          target.pbxNativeTarget.productReference,
      ),
    ).toBe(true)
    const resources = target.pbxNativeTarget.buildPhases.find(
      (phase) => phase.comment === "Resources",
    )
    expect(objects.PBXResourcesBuildPhase[resources.value].files).toHaveLength(
      6,
    )
    const configurations =
      objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList]
        .buildConfigurations
    for (const reference of configurations) {
      const settings =
        objects.XCBuildConfiguration[reference.value].buildSettings
      expect(settings).toMatchObject({
        SDKROOT: "appletvos",
        TARGETED_DEVICE_FAMILY: "3",
        APPLICATION_EXTENSION_API_ONLY: "YES",
        CURRENT_PROJECT_VERSION: config.ios.buildNumber ?? 12,
        MARKETING_VERSION: config.version,
      })
      expect(settings.PRODUCT_BUNDLE_IDENTIFIER).toBe(
        `"${config.ios.bundleIdentifier}.TopShelf"`,
      )
    }
  })

  it("falls back to native build settings only when Expo has no build number", () => {
    const project = projectFixture()
    const withoutBuildNumber = { ...config, ios: { ...config.ios } }
    delete withoutBuildNumber.ios.buildNumber
    const target = withTopShelf.addTopShelfTarget(project, withoutBuildNumber)
    const objects = project.hash.project.objects
    const list =
      objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList]
    for (const reference of list.buildConfigurations) {
      expect(
        objects.XCBuildConfiguration[reference.value].buildSettings
          .CURRENT_PROJECT_VERSION,
      ).toBe(12)
    }
  })

  it("does not duplicate targets, resources, embed phases or dependencies on repeat prebuild", () => {
    const project = projectFixture()
    withTopShelf.addTopShelfTarget(project, config)
    const first = project.writeSync()
    withTopShelf.addTopShelfTarget(project, config)
    expect(project.writeSync()).toBe(first)
  })

  it("declares EAS extension credentials without replacing unrelated app config", () => {
    const input = JSON.parse(JSON.stringify(config))
    withTopShelf(input)
    withTopShelf(input)
    expect(input.extra.eas.projectId).toBe(config.extra.eas.projectId)
    expect(input.extra.eas.build.experimental.ios.appExtensions).toEqual([
      {
        targetName: "ForgeTopShelf",
        bundleIdentifier: `${config.ios.bundleIdentifier}.TopShelf`,
        entitlements: {
          "com.apple.security.application-groups": [
            `group.${config.ios.bundleIdentifier}.topshelf`,
          ],
        },
      },
    ])
  })

  it("ships four unique playable-film slugs and local artwork within a small bundle", () => {
    expect(catalog).toHaveLength(4)
    expect(new Set(catalog.map((item) => item.id)).size).toBe(4)
    expect(new Set(catalog.map((item) => item.slug)).size).toBe(4)
    let bytes = 0
    for (const video of catalog) {
      expect(video.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(video.title.length).toBeGreaterThan(0)
      expect(video.summary.length).toBeLessThan(220)
      expect(video.duration).toBeGreaterThan(0)
      expect(["imagedelivery.net", "image.mux.com"]).toContain(
        new URL(video.imageURL).hostname,
      )
      const image = fs.readFileSync(
        path.join(__dirname, "../top-shelf", video.imageName),
      )
      expect(image.subarray(0, 2).toString("hex")).toBe(
        video.imageName.endsWith(".png") ? "8950" : "ffd8",
      )
      bytes += image.length
    }
    expect(bytes).toBeLessThan(5_000_000)
  })

  it("uses the modern extension point and existing Play / More Info routes, without a network or player dependency", () => {
    const provider = fs.readFileSync(
      path.join(__dirname, "../top-shelf/ContentProvider.swift"),
      "utf8",
    )
    const plist = fs.readFileSync(
      path.join(__dirname, "../top-shelf/Info.plist"),
      "utf8",
    )
    expect(plist).toContain("com.apple.tv-top-shelf")
    expect(plist).toContain(config.scheme)
    expect(provider).toContain("TVTopShelfContentProvider")
    expect(provider).toContain("TVTopShelfCarouselContent(style: .details")
    expect(provider).toContain('components.host = "watch"')
    expect(provider).toContain('URLQueryItem(name: "autoplay", value: "1")')
    expect(provider).toContain("autoplay: false")
    expect(provider).toContain("autoplay: true")
    expect(provider).not.toMatch(/URLSession|AVPlayer|import React/)
  })
})
