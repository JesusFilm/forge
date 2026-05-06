import { describe, expect, it } from "vitest"
import { generateImageMetadata } from "./image-metadata.service"

describe("generateImageMetadata", () => {
  it("generates a Next Image-compatible blur data URL for PNG bytes", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03,
      0x08, 0x02, 0x00, 0x00, 0x00,
    ])

    const metadata = generateImageMetadata(png)

    expect(metadata.width).toBe(2)
    expect(metadata.height).toBe(3)
    expect(metadata.blurDataUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(metadata.dominantColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it("rejects empty image bytes", () => {
    expect(() => generateImageMetadata(new Uint8Array())).toThrow(
      "Image bytes are empty",
    )
  })
})
