export function shouldUseNativeSwiftPlayer({
  variant,
  hydrated,
  platform,
}: {
  variant: "existing" | "native-a" | "native-b"
  hydrated: boolean
  platform: string
}): boolean {
  return platform === "ios" && hydrated && variant !== "existing"
}
