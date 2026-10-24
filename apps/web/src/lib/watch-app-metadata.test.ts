import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import manifest from "@/app/manifest"
import { WATCH_APP_METADATA } from "./watch-app-metadata"

const publicAsset = (path: string): Buffer =>
  readFileSync(new URL(`../../public/${path}`, import.meta.url))

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  )

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function icoDimensions(buffer: Buffer): Array<{
  width: number
  height: number
}> {
  expect(buffer.readUInt16LE(0)).toBe(0)
  expect(buffer.readUInt16LE(2)).toBe(1)
  const imageCount = buffer.readUInt16LE(4)

  return Array.from({ length: imageCount }, (_, index) => {
    const offset = 6 + index * 16
    const width = buffer[offset] ?? 0
    const height = buffer[offset + 1] ?? 0
    return {
      width: width === 0 ? 256 : width,
      height: height === 0 ? 256 : height,
    }
  })
}

describe("Watch app metadata", () => {
  it("declares accurate favicon and touch-icon metadata", () => {
    expect(WATCH_APP_METADATA).toMatchObject({
      manifest: "/watch/manifest.webmanifest",
      icons: {
        icon: [
          {
            url: "/watch/favicon.ico",
            sizes: "16x16 32x32 48x48",
            type: "image/x-icon",
          },
          {
            url: "/watch/images/favicon-32.png",
            sizes: "32x32",
            type: "image/png",
          },
          {
            url: "/watch/images/favicon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
        apple: [
          {
            url: "/watch/images/favicon-180.png",
            sizes: "180x180",
            type: "image/png",
          },
        ],
      },
    })
  })

  it.each([
    ["images/favicon-32.png", 32],
    ["images/favicon-180.png", 180],
    ["images/favicon-192.png", 192],
    ["images/favicon-512.png", 512],
  ])("encodes %s as a real %ix%i PNG", (path, size) => {
    expect(pngDimensions(publicAsset(path))).toEqual({
      width: size,
      height: size,
    })
  })

  it("encodes the ICO fallback at 16, 32, and 48 pixels", () => {
    expect(icoDimensions(publicAsset("favicon.ico"))).toEqual([
      { width: 16, height: 16 },
      { width: 32, height: 32 },
      { width: 48, height: 48 },
    ])
  })

  it("publishes install icons whose files match the manifest", () => {
    const result = manifest()
    expect(result).toMatchObject({
      start_url: "/watch",
      scope: "/watch/",
      icons: [
        {
          src: "/watch/images/favicon-192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "/watch/images/favicon-512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
    })
  })
})
