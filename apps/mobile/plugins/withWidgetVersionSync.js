// Loaded defensively, matching the other plugins here: Expo config plugins are
// only resolvable in prebuild contexts.
let withXcodeProject = null
try {
  ;({ withXcodeProject } = require("expo/config-plugins"))
} catch {
  withXcodeProject = null
}

const TARGET_NAME = "ExpoWidgetsTarget"
const PHASE_NAME = "Copy app version to widget extension"

// EAS writes its build number only into each target's Info.plist file, but
// Xcode generates the extension's CFBundleVersion from CURRENT_PROJECT_VERSION
// ("1"). The phase copies the app's version keys into the extension's plist.
function versionSyncScript(projectName) {
  return [
    "set -e",
    `APP_PLIST="$SRCROOT/${projectName}/Info.plist"`,
    'EXT_PLIST="$TARGET_BUILD_DIR/$INFOPLIST_PATH"',
    "for KEY in CFBundleVersion CFBundleShortVersionString; do",
    '  VALUE=$(/usr/libexec/PlistBuddy -c "Print :$KEY" "$APP_PLIST")',
    '  /usr/libexec/PlistBuddy -c "Set :$KEY $VALUE" "$EXT_PLIST"',
    "done",
  ].join("\\n")
}

function addVersionSyncPhase(project, projectName) {
  const target = project.pbxTargetByName(TARGET_NAME)
  if (!target) {
    throw new Error(
      `[withWidgetVersionSync] no "${TARGET_NAME}" target. List this plugin ` +
        `BEFORE "expo-widgets" in app.json: a later plugin's mod runs first.`,
    )
  }
  if (target.buildPhases.some((phase) => phase.comment === PHASE_NAME)) {
    return project
  }
  const { buildPhase } = project.addBuildPhase(
    [],
    "PBXShellScriptBuildPhase",
    PHASE_NAME,
    project.findTargetKey(TARGET_NAME),
    {
      shellPath: "/bin/sh",
      shellScript: versionSyncScript(projectName),
      // The processed plist as an input orders this phase after Xcode writes it.
      inputPaths: [
        `"$(SRCROOT)/${projectName}/Info.plist"`,
        '"$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)"',
      ],
      outputPaths: [],
    },
  )
  buildPhase.alwaysOutOfDate = 1
  return project
}

module.exports = function withWidgetVersionSync(config) {
  if (!withXcodeProject) return config
  return withXcodeProject(config, (cfg) => {
    addVersionSyncPhase(cfg.modResults, cfg.modRequest.projectName)
    return cfg
  })
}

module.exports.addVersionSyncPhase = addVersionSyncPhase
module.exports.PHASE_NAME = PHASE_NAME
