import appConfig from "../../app.json"

// Regression guard: a standalone/production build crashes at launch
// (expo-router getInitialURL → expo-linking resolveScheme) when the Expo
// config has no top-level `scheme`. Dev returns "exp", so only standalone hits it.
describe("app.json Expo config", () => {
  it("defines a non-empty top-level scheme (prevents standalone launch crash)", () => {
    const scheme: unknown = appConfig.expo.scheme
    const schemes = Array.isArray(scheme) ? scheme : [scheme]
    expect(schemes.length).toBeGreaterThan(0)
    expect(schemes.every((s) => typeof s === "string" && s.length > 0)).toBe(
      true,
    )
  })
})
