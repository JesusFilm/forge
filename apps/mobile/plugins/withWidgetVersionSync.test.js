/* global afterEach */
const fs = require("fs")
const os = require("os")
const path = require("path")
const { IOSConfig } = require("expo/config-plugins")
const { addVersionSyncPhase, PHASE_NAME } = require("./withWidgetVersionSync")

/** The two native targets a prebuild with expo-widgets emits, and nothing else. */
const PBXPROJ = `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 54;
	objects = {
/* Begin PBXNativeTarget section */
		13B07F861A680F5B00A75B9A /* forgewatch */ = {
			isa = PBXNativeTarget;
			buildPhases = (
			);
			name = forgewatch;
			productName = forgewatch;
		};
		4F1A2B3C4D5E6F7A8B9C0D1E /* ExpoWidgetsTarget */ = {
			isa = PBXNativeTarget;
			buildPhases = (
			);
			name = ExpoWidgetsTarget;
			productName = ExpoWidgetsTarget;
		};
/* End PBXNativeTarget section */
/* Begin PBXProject section */
		83CBB9F71A601CBA00E9B192 /* Project object */ = {
			isa = PBXProject;
			targets = (
				13B07F861A680F5B00A75B9A /* forgewatch */,
				4F1A2B3C4D5E6F7A8B9C0D1E /* ExpoWidgetsTarget */,
			);
		};
/* End PBXProject section */
	};
	rootObject = 83CBB9F71A601CBA00E9B192 /* Project object */;
}
`

const roots = []

/** Parses the fixture the same way a prebuild mod receives its project. */
function project(pbxproj = PBXPROJ) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "widget-version-sync-"))
  roots.push(root)
  const dir = path.join(root, "ios", "forgewatch.xcodeproj")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "project.pbxproj"), pbxproj)
  return IOSConfig.XcodeUtils.getPbxproj(root)
}

function syncPhases(xcodeProject, targetName) {
  const target = xcodeProject.pbxTargetByName(targetName)
  const scripts = xcodeProject.hash.project.objects.PBXShellScriptBuildPhase
  return target.buildPhases
    .filter((phase) => phase.comment === PHASE_NAME)
    .map((phase) => scripts[phase.value])
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe("the widget extension takes the app's version", () => {
  it("adds one phase that copies both version keys from the app's Info.plist", () => {
    const xcodeProject = addVersionSyncPhase(project(), "forgewatch")

    const phases = syncPhases(xcodeProject, "ExpoWidgetsTarget")
    expect(phases).toHaveLength(1)
    const script = phases[0].shellScript
    expect(script).toContain("$SRCROOT/forgewatch/Info.plist")
    expect(script).toContain("$TARGET_BUILD_DIR/$INFOPLIST_PATH")
    expect(script).toContain("CFBundleVersion CFBundleShortVersionString")
    // The app target keeps its own version; only the extension copies it.
    expect(syncPhases(xcodeProject, "forgewatch")).toHaveLength(0)
  })

  it("adds no second phase when prebuild runs the mod again", () => {
    const once = addVersionSyncPhase(project(), "forgewatch")
    const twice = addVersionSyncPhase(once, "forgewatch")

    expect(syncPhases(twice, "ExpoWidgetsTarget")).toHaveLength(1)
  })

  it("adds no second phase to a project read back from disk", () => {
    // A prebuild without --clean parses the phase that the last run wrote.
    const written = addVersionSyncPhase(project(), "forgewatch").writeSync()
    const reread = addVersionSyncPhase(project(written), "forgewatch")

    expect(syncPhases(reread, "ExpoWidgetsTarget")).toHaveLength(1)
  })

  it("stops prebuild with a clear message when the extension target is missing", () => {
    const withoutWidget = PBXPROJ.replace(
      /\t\t4F1A2B3C4D5E6F7A8B9C0D1E \/\* ExpoWidgetsTarget \*\/ = \{[\s\S]*?\t\t\};\n/,
      "",
    )

    expect(() =>
      addVersionSyncPhase(project(withoutWidget), "forgewatch"),
    ).toThrow(/no "ExpoWidgetsTarget" target.*BEFORE "expo-widgets"/)
  })
})
