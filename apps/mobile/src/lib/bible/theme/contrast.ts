// WCAG 2.x contrast for the reader's palettes (feat-551 R36). A translucent
// colour is judged over the ground it sits on, never on its own, per
// docs/solutions/best-practices/wcag-contrast-guard-bound-to-variant-artifact-not-property.md.

export type Rgba = { r: number; g: number; b: number; a: number }

/** A colour string that the contrast math cannot read. */
export class ReaderColorError extends Error {
  constructor(color: string) {
    super(`Not a #rrggbb or rgba() colour: ${color}`)
    this.name = "ReaderColorError"
  }
}

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
const RGBA =
  /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i

export function parseColor(color: string): Rgba {
  const hex = HEX.exec(color)
  if (hex) {
    const [, r = "", g = "", b = ""] = hex
    return {
      r: parseInt(r, 16),
      g: parseInt(g, 16),
      b: parseInt(b, 16),
      a: 1,
    }
  }
  const rgba = RGBA.exec(color)
  if (rgba) {
    const [, r = "", g = "", b = "", a] = rgba
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a ?? 1) }
  }
  throw new ReaderColorError(color)
}

/** `top` drawn over `bottom`; the result is opaque when `bottom` is. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const mix = (over: number, under: number) =>
    over * top.a + under * (1 - top.a)
  return {
    r: mix(top.r, bottom.r),
    g: mix(top.g, bottom.g),
    b: mix(top.b, bottom.b),
    a: top.a + bottom.a * (1 - top.a),
  }
}

function channel(value: number): number {
  const unit = value / 255
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(color: Rgba): number {
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  )
}

// The contrast of `foreground` over `background`. Each layer composites over
// the next one down, so pass the page colour as the last layer.
export function contrastRatio(
  foreground: string,
  background: string,
  ...grounds: string[]
): number {
  const ground = [background, ...grounds]
    .map(parseColor)
    .reduceRight<Rgba | null>(
      (under, layer) => (under ? composite(layer, under) : layer),
      null,
    )
  if (!ground) throw new ReaderColorError(background)
  const fore = composite(parseColor(foreground), ground)
  const [light, dark] = [relativeLuminance(fore), relativeLuminance(ground)]
    .sort((a, b) => b - a)
    .map((value) => value + 0.05)
  return (light ?? 1) / (dark ?? 1)
}
