type AssetPreview = {
  previewUrl?: unknown
}

export function blockImageAssetPreviewUrl(value: unknown): string | null {
  if (value == null || typeof value !== "object") return null

  const previewUrl = (value as AssetPreview).previewUrl
  return typeof previewUrl === "string" && previewUrl.trim() !== ""
    ? previewUrl
    : null
}
