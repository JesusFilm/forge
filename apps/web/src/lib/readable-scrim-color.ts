export type Rgb = { r: number; g: number; b: number }

const MIN_WHITE_TEXT_CONTRAST = 4.5

export function hexToRgb(value: string): Rgb | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim())
  if (!match) return null

  const hex = match[1]
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

export function readableScrimRgb(value: string | null): Rgb | null {
  const rgb = value ? hexToRgb(value) : null
  if (!rgb) return null

  let factor = 1
  let candidate = rgb
  while (
    contrastRatio(relativeLuminance(candidate), 1) < MIN_WHITE_TEXT_CONTRAST &&
    factor > 0.25
  ) {
    factor -= 0.05
    candidate = {
      r: Math.round(rgb.r * factor),
      g: Math.round(rgb.g * factor),
      b: Math.round(rgb.b * factor),
    }
  }

  return candidate
}

function contrastRatio(a: number, b: number) {
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance({ r, g, b }: Rgb) {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}
