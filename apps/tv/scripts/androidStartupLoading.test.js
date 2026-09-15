/* global require, describe, it, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const { injectStartupLoading } = require("../plugins/withAndroidStartupLoading")

describe("Android native startup loading", () => {
  it("attaches the loader after ReactActivity creates its content", () => {
    const result = injectStartupLoading(
      "before\n    super.onCreate(null)\nafter",
    )
    expect(result).toBe(
      "before\n    super.onCreate(null)\n    expo.modules.nativeandroidplayer.StartupLoadingOverlay.show(this)\nafter",
    )
  })
  it("preserves savedInstanceState and is idempotent", () => {
    const once = injectStartupLoading("super.onCreate(savedInstanceState)")
    expect(once).toContain("super.onCreate(savedInstanceState)")
    expect(injectStartupLoading(once)).toBe(once)
  })
  it("fails visibly when the activity template changes", () => {
    expect(() => injectStartupLoading("class OtherActivity")).toThrow(
      "onCreate not found",
    )
  })
})
