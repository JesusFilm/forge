/** Native starts/resumes bypass Manager's immutable input and operation claims. */
export function isBlockedEnrichmentNativeMutation(
  method: string,
  pathname: string,
): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false
  const match = /^\/api\/workflows\/([^/]+)(?:\/|$)/.exec(pathname)
  if (!match?.[1]) return false
  try {
    return ["forge-video-enrichment", "forgeVideoEnrichmentWorkflow"].includes(
      decodeURIComponent(match[1]),
    )
  } catch {
    return false
  }
}
