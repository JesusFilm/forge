import { describe, expect, it } from "vitest"
import { generateImageMetadata } from "./image-metadata.service"

describe("generateImageMetadata", () => {
  it("generates a raster Next Image-compatible blur data URL", async () => {
    const image = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"><rect width="2" height="3" fill="#ff0000"/></svg>',
    )

    const metadata = await generateImageMetadata(image)

    expect(metadata.width).toBe(2)
    expect(metadata.height).toBe(3)
    expect(metadata.blurDataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(metadata.blurDataUrl).not.toContain("<svg")
    expect(metadata.dominantColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(metadata.dominantColor).not.toBe("#111827")
  })

  it("rejects empty image bytes", async () => {
    await expect(generateImageMetadata(new Uint8Array())).rejects.toThrow(
      "Image bytes are empty",
    )
  })

  it("rejects corrupt image bytes with a domain error", async () => {
    await expect(
      generateImageMetadata(new TextEncoder().encode("not an image")),
    ).rejects.toThrow("Unable to generate image metadata")
  })
})
