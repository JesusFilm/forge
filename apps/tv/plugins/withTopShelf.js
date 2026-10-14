/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const {
  withXcodeProject,
  withEntitlementsPlist,
  withInfoPlist,
} = require("expo/config-plugins")
const catalog = require("../top-shelf/catalog.json")

const TARGET_NAME = "ForgeTopShelf"
const appGroup = (config) => `group.${config.ios.bundleIdentifier}.topshelf`
const unquote = (value) => String(value ?? "").replace(/^"|"$/g, "")
const resources = [
  "catalog.json",
  ...catalog.flatMap((video) => [
    video.imageName,
    ...(video.previewName ? [video.previewName] : []),
  ]),
]

function addTopShelfTarget(project, config) {
  const targets = project.pbxNativeTargetSection()
  const existing = Object.entries(targets).find(
    ([key, value]) =>
      !key.endsWith("_comment") && unquote(value.name) === TARGET_NAME,
  )
  const bundleId = `${config.ios.bundleIdentifier}.TopShelf`
  let target

  if (existing) {
    target = { uuid: existing[0], pbxNativeTarget: existing[1] }
  } else {
    project.hash.project.objects.PBXTargetDependency ??= {}
    project.hash.project.objects.PBXContainerItemProxy ??= {}
    target = project.addTarget(
      TARGET_NAME,
      "app_extension",
      TARGET_NAME,
      bundleId,
    )
    const group = project.addPbxGroup([], TARGET_NAME, TARGET_NAME)
    project.addToPbxGroup(
      group.uuid,
      project.getFirstProject().firstProject.mainGroup,
    )
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid)
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      target.uuid,
    )
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      target.uuid,
    )
    project.addSourceFile(
      "ContentProvider.swift",
      { target: target.uuid },
      group.uuid,
    )
    project.addFile("Info.plist", group.uuid)
    project.addFramework("TVServices.framework", {
      target: target.uuid,
      link: true,
    })
  }

  const objects = project.hash.project.objects
  const groupEntry = Object.entries(objects.PBXGroup).find(
    ([key, value]) =>
      !key.endsWith("_comment") && unquote(value.name) === TARGET_NAME,
  )
  for (const resource of resources) {
    const file = project.addFile(resource, groupEntry[0])
    if (!file) continue
    file.uuid = project.generateUuid()
    file.target = target.uuid
    project.addToPbxBuildFileSection(file)
    project.addToPbxResourcesBuildPhase(file)
  }
  const mainTarget = project.getFirstTarget().firstTarget
  const mainConfigs =
    objects.XCConfigurationList[mainTarget.buildConfigurationList]
      .buildConfigurations
  const configurations =
    objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList]
      .buildConfigurations
  for (const reference of configurations) {
    const build = objects.XCBuildConfiguration[reference.value]
    const mainReference = mainConfigs.find(
      (entry) => objects.XCBuildConfiguration[entry.value].name === build.name,
    )
    const mainSettings =
      objects.XCBuildConfiguration[mainReference.value].buildSettings
    Object.assign(build.buildSettings, {
      APPLICATION_EXTENSION_API_ONLY: "YES",
      CODE_SIGN_ENTITLEMENTS: `"${TARGET_NAME}/TopShelf.entitlements"`,
      CLANG_ENABLE_MODULES: "YES",
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION:
        config.ios.buildNumber ?? mainSettings.CURRENT_PROJECT_VERSION ?? "1",
      DEVELOPMENT_TEAM: config.ios.appleTeamId ?? mainSettings.DEVELOPMENT_TEAM,
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `"${TARGET_NAME}/Info.plist"`,
      MARKETING_VERSION: config.version ?? mainSettings.MARKETING_VERSION,
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"`,
      SDKROOT: "appletvos",
      SKIP_INSTALL: "YES",
      SUPPORTED_PLATFORMS: '"appletvos appletvsimulator"',
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: "3",
      TVOS_DEPLOYMENT_TARGET: mainSettings.TVOS_DEPLOYMENT_TARGET ?? "16.0",
    })
  }

  // Embed before scripts that inspect the finished app to avoid Xcode dependency cycles.
  const embedIndex = mainTarget.buildPhases.findIndex((phase) => {
    const copy = objects.PBXCopyFilesBuildPhase?.[phase.value]
    return copy?.files.some(
      (file) =>
        objects.PBXBuildFile[file.value]?.fileRef ===
        target.pbxNativeTarget.productReference,
    )
  })
  if (embedIndex >= 0) {
    const [embed] = mainTarget.buildPhases.splice(embedIndex, 1)
    mainTarget.buildPhases.unshift(embed)
  }
  return target
}

function withTopShelf(config) {
  const eas = ((config.extra ??= {}).eas ??= {})
  const ios = (((eas.build ??= {}).experimental ??= {}).ios ??= {})
  ios.appExtensions = [
    ...(ios.appExtensions ?? []).filter(
      (item) => item.targetName !== TARGET_NAME,
    ),
    {
      targetName: TARGET_NAME,
      bundleIdentifier: `${config.ios.bundleIdentifier}.TopShelf`,
      entitlements: {
        "com.apple.security.application-groups": [appGroup(config)],
      },
    },
  ]

  config = withEntitlementsPlist(config, (mod) => {
    const groups = mod.modResults["com.apple.security.application-groups"] ?? []
    mod.modResults["com.apple.security.application-groups"] = [
      ...new Set([...groups, appGroup(config)]),
    ]
    return mod
  })
  config = withInfoPlist(config, (mod) => {
    mod.modResults.ForgeTopShelfAppGroup = appGroup(config)
    return mod
  })
  return withXcodeProject(config, (mod) => {
    const source = path.join(mod.modRequest.projectRoot, "top-shelf")
    const destination = path.join(
      mod.modRequest.platformProjectRoot,
      TARGET_NAME,
    )
    fs.mkdirSync(destination, { recursive: true })
    for (const file of ["ContentProvider.swift", "Info.plist", ...resources]) {
      fs.copyFileSync(path.join(source, file), path.join(destination, file))
    }
    const plist = require("@expo/plist").default
    const infoPath = path.join(destination, "Info.plist")
    const info = plist.parse(fs.readFileSync(infoPath, "utf8"))
    info.ForgeURLScheme = config.scheme
    info.ForgeTopShelfAppGroup = appGroup(config)
    fs.writeFileSync(infoPath, plist.build(info))
    fs.writeFileSync(
      path.join(destination, "TopShelf.entitlements"),
      plist.build({
        "com.apple.security.application-groups": [appGroup(config)],
      }),
    )
    addTopShelfTarget(mod.modResults, config)
    return mod
  })
}

module.exports = withTopShelf
module.exports.addTopShelfTarget = addTopShelfTarget
