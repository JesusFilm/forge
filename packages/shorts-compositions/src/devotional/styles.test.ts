import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { devotionalRenderConfigSchema, resolveDevotionalStyle } from "./styles"

const config = devotionalRenderConfigSchema.parse(
  JSON.parse(
    readFileSync(
      path.resolve(
        "../../apps/mastra/devotional-workspace/inputs/render/styles.json",
      ),
      "utf8",
    ),
  ),
)

describe("Workspace devotional render configuration", () => {
  it("preserves the current deterministic filter/layout composition", () => {
    const style = resolveDevotionalStyle("splittone", undefined, config)
    expect(style.label).toBe("Split-tone (clean)")
    expect(style.layoutId).toBe("editorial")
    expect(style.splitTone).toBe(true)
  })

  it("lets any validated filter pair with a validated layout", () => {
    const style = resolveDevotionalStyle("grain", "grounded", config)
    expect(style.id).toBe("grain")
    expect(style.layoutId).toBe("grounded")
    expect(style.textBottom).toBe(true)
  })

  it("rejects malformed Workspace palettes before rendering", () => {
    expect(() =>
      devotionalRenderConfigSchema.parse({
        ...config,
        filters: {
          ...config.filters,
          grain: { ...config.filters.grain, grainMedia: 2 },
        },
      }),
    ).toThrow()
  })

  it("fails closed when no Workspace render config is supplied", () => {
    expect(() => resolveDevotionalStyle("grain", undefined)).toThrow(
      "/inputs/render/styles.json",
    )
  })
})
