import { describe, expect, it } from "vitest"
import { countMarker } from "./probe-experience-editor-video-data"

describe("experience editor video data probe", () => {
  it("counts direct and escaped Dub markers independently", () => {
    expect(
      countMarker(
        '{"streamUrl":"one"}\\n{\\"streamUrl\\":\\"two\\"}{\\"streamUrl\\":\\"three\\"}',
        '"streamUrl"',
      ),
    ).toBe(3)
  })

  it("handles an empty marker without looping", () => {
    expect(countMarker("response", "")).toBe(0)
  })
})
