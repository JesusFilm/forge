import { PixelRatio, type ImageStyle } from "react-native"

// Each bitmap pixel spans at least shrink x MIN_OVERSCAN screen pixels. The
// call sites choose their shrink factor for that size.
export const MIN_OVERSCAN = 1.1

// A soft expo-image on Android without blurRadius, which runs RenderScript and
// can crash the app (feat-784). Glide decodes the small box at its own size,
// and the scale stretches that bitmap over the frame. The parent must clip.
export function stretchedDecodeStyle(
  frameWidth: number,
  frameHeight: number,
  shrink: number,
  pixelRatio: number = PixelRatio.get(),
): ImageStyle {
  const width = frameWidth / shrink
  const height = frameHeight / shrink
  // Layout rounds the box edges to whole pixels, so the box can lose one pixel
  // and move half a pixel. The scale covers the frame in that worst case too.
  const pixel = 1 / pixelRatio
  const cover = Math.max(
    (frameWidth + pixel) / (width - pixel),
    (frameHeight + pixel) / (height - pixel),
  )
  return {
    position: "absolute",
    left: (frameWidth - width) / 2,
    top: (frameHeight - height) / 2,
    width,
    height,
    transform: [{ scale: Math.max(shrink * MIN_OVERSCAN, cover) }],
  }
}
