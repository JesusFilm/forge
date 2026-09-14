const { addMmkvDefine, MARKER } = require("./withMmkvSecureWipeFix")

/** The generated Podfile's post_install block, as prebuild emits it. */
function podfile() {
  return [
    "target 'forgewatch' do",
    "  use_expo_modules!",
    "",
    "  post_install do |installer|",
    "    react_native_post_install(",
    "      installer,",
    "      config[:reactNativePath],",
    "      :mac_catalyst_enabled => false,",
    "    )",
    "  end",
    "end",
    "",
  ].join("\n")
}

describe("MMKV compiles under Xcode 26", () => {
  it("defines the macro that makes memset_s visible", () => {
    const out = addMmkvDefine(podfile())

    expect(out).toContain(`${MARKER}=1`)
    // Scoped to MMKV's own targets — this is a workaround for one pod, not an
    // app-wide language-mode change.
    expect(out).toContain("['MMKVCore', 'MMKV'].include?(target.name)")
  })

  it("keeps the react-native post_install call it inserts beside", () => {
    // The hook is added INSIDE the existing block, so dropping the vendor call
    // would break every other pod while this one compiled.
    const out = addMmkvDefine(podfile())

    expect(out).toContain("react_native_post_install(")
    expect(out.indexOf("post_install do |installer|")).toBeLessThan(
      out.indexOf(MARKER),
    )
  })

  it("is idempotent — prebuild re-runs mods over generated output", () => {
    const once = addMmkvDefine(podfile())
    const twice = addMmkvDefine(once)

    expect(twice).toBe(once)
    expect(twice.split(MARKER)).toHaveLength(2)
  })

  it("fails loudly when the template has no post_install block", () => {
    // Silently returning the Podfile unchanged would hand back a project that
    // cannot compile, with nothing naming why.
    expect(() => addMmkvDefine("target 'forgewatch' do\nend\n")).toThrow(
      /no post_install block/,
    )
  })

  it("negative control: an untouched Podfile carries no marker", () => {
    expect(podfile()).not.toContain(MARKER)
  })
})
