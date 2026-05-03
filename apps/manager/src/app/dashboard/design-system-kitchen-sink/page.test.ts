import { describe, expect, it } from "vitest"
import DesignSystemKitchenSinkPage, { metadata } from "./page"

describe("design system kitchen sink page", () => {
  it("renders as a hidden dashboard page without route data dependencies", () => {
    const element = DesignSystemKitchenSinkPage()

    expect(metadata.title).toBe("Design System Kitchen Sink -- Studio")
    expect(element.type.name).toBe("DesignSystemKitchenSink")
  })
})
