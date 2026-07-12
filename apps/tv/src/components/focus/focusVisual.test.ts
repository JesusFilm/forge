import { scale } from "../../lib/scale"
import {
  FOCUS_DURATION_MS,
  FOCUS_RING_COLOR,
  FOCUS_RING_WIDTH,
  focusShadowStyle,
  resolveFocusVisual,
} from "./focusVisual"

describe("focus visual contract", () => {
  it("keeps the single curve and ring constants", () => {
    expect(FOCUS_DURATION_MS).toBe(180)
    expect(FOCUS_RING_COLOR).toBe("rgba(255,255,255,0.9)")
    expect(FOCUS_RING_WIDTH).toBe(scale(5))
  })

  it("locks the role presets the census converged on", () => {
    expect(resolveFocusVisual("card")).toMatchObject({ magnify: 1.05, lift: 0 })
    expect(resolveFocusVisual("thumb")).toMatchObject({
      magnify: 1.06,
      lift: scale(8),
    })
    expect(resolveFocusVisual("cta")).toMatchObject({ magnify: 1.05, lift: 0 })
    expect(resolveFocusVisual("cta").shadow.color).toBe("accent")
    expect(resolveFocusVisual("pill")).toMatchObject({
      magnify: 1.06,
      lift: scale(4),
    })
    expect(resolveFocusVisual("tab")).toMatchObject({ magnify: 1.07, lift: 0 })
    expect(resolveFocusVisual("key")).toMatchObject({ magnify: 1.1, lift: 0 })
    expect(resolveFocusVisual("key").shadow).toMatchObject({
      radius: scale(14),
      opacity: 0.7,
      elevation: 8,
    })
    expect(resolveFocusVisual("option")).toMatchObject({
      magnify: 1.015,
      lift: 0,
    })
    expect(resolveFocusVisual("tile")).toMatchObject({ magnify: 1.02 })
    expect(resolveFocusVisual("row")).toMatchObject({ magnify: 1, lift: 0 })
  })

  it("applies overrides without mutating the preset", () => {
    const overridden = resolveFocusVisual("card", { magnify: 1.1 })
    expect(overridden.magnify).toBe(1.1)
    expect(overridden.lift).toBe(0)
    expect(resolveFocusVisual("card").magnify).toBe(1.05)
  })
})

describe("focusShadowStyle", () => {
  it("builds a neutral dark shadow with elevation only when positive", () => {
    const style = focusShadowStyle(resolveFocusVisual("card").shadow)
    expect(style.shadowColor).toBe("#000000")
    expect(style.elevation).toBe(8)
    const thumb = focusShadowStyle(resolveFocusVisual("thumb").shadow)
    expect(thumb.elevation).toBeUndefined()
  })

  it("uses the accent color for accent shadows and falls back to neutral without one", () => {
    const spec = resolveFocusVisual("cta").shadow
    expect(focusShadowStyle(spec, "#E1241E").shadowColor).toBe("#E1241E")
    expect(focusShadowStyle(spec).shadowColor).toBe("#000000")
  })
})
