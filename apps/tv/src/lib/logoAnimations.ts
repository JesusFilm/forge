export const LOGO_ANIMATIONS = [
  { id: "01", name: "Diagonal light sweep" },
  { id: "02", name: "Neon edge tracing" },
  { id: "03", name: "Breathing glow" },
  { id: "04", name: "Red glass" },
  { id: "05", name: "Brushed metal" },
  { id: "06", name: "Orbiting spotlight" },
  { id: "07", name: "Light ripples" },
  { id: "08", name: "Particle outline" },
  { id: "09", name: "Cinematic reveal" },
  { id: "10", name: "Silk reflections" },
] as const

export type LogoAnimationId = (typeof LOGO_ANIMATIONS)[number]["id"]
export const DEFAULT_STARTUP_ANIMATION: LogoAnimationId = "09"
export const DEFAULT_LOADING_ANIMATION: LogoAnimationId = "03"
export const LOGO_PREVIEW_DURATION_MS = 6030

export function parseLogoAnimationId(
  value: unknown,
  fallback: LogoAnimationId,
): LogoAnimationId {
  return LOGO_ANIMATIONS.find((option) => option.id === value)?.id ?? fallback
}
