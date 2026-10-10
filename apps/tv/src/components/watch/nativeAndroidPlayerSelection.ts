export function shouldUseNativeAndroidPlayer({
  variant,
  hydrated,
  platform,
}: {
  variant: "existing" | "native"
  hydrated: boolean
  platform: string
}): boolean {
  return platform === "android" && hydrated && variant === "native"
}
