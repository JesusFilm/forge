export function canonicalTypesenseVideoId(
  videoId: string,
  coreId: string | null,
): string {
  const normalizedCoreId = coreId?.trim().toLocaleLowerCase()
  if (!normalizedCoreId) return `video:${videoId}`
  const canonicalCoreId = normalizedCoreId.replace(
    /(?:[-_.]?ad)?[-_.]?(?:1x1|9x16|16x9)$/i,
    "",
  )
  return `core:${canonicalCoreId || normalizedCoreId}`
}
