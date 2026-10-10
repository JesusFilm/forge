const fs = require("fs")
const path = require("path")

const { DISPLAY_NAME, setAppName } = require("./withAndroidAppName")

// The strings.xml shape the xml2js-backed parser hands a mod, after Expo's own
// name mod has written `app_name` from `expo.name`.
function prebuiltStrings() {
  return {
    resources: {
      string: [
        { $: { name: "app_name" }, _: "forge-watch" },
        { $: { name: "expo_system_ui_user_interface_style" }, _: "automatic" },
      ],
    },
  }
}

describe("withAndroidAppName", () => {
  it("names the app Jesus Film Watch", () => {
    expect(DISPLAY_NAME).toBe("Jesus Film Watch")
  })

  it("replaces Expo's app_name and leaves the other strings alone", () => {
    const result = setAppName(prebuiltStrings(), DISPLAY_NAME)

    expect(result.resources.string).toEqual([
      { $: { name: "app_name" }, _: "Jesus Film Watch" },
      { $: { name: "expo_system_ui_user_interface_style" }, _: "automatic" },
    ])
  })

  it("adds app_name when the file has none", () => {
    const result = setAppName({ resources: {} }, DISPLAY_NAME)

    expect(result.resources.string).toEqual([
      { $: { name: "app_name" }, _: "Jesus Film Watch" },
    ])
  })

  // Both platforms must show the same name, and expo.name must stay: it names
  // the generated native projects that docs and build recipes point at.
  it("matches the iOS display name, and leaves expo.name alone", () => {
    const { expo } = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "app.json"), "utf8"),
    )

    expect(expo.ios.infoPlist.CFBundleDisplayName).toBe(DISPLAY_NAME)
    expect(expo.name).toBe("forge-watch")
    expect(expo.plugins).toContain("./plugins/withAndroidAppName")
  })
})
