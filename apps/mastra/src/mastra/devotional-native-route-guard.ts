const PROTECTED_WORKFLOW_IDS = new Set([
  "daily-devotional",
  "video-first-devotional",
  "devotional-source",
  "devotional-content",
  "devotional-produce",
  "devotional-render",
  "devotional-approve",
  "devotional-publish",
])

export function isBlockedDevotionalNativeMutation(
  method: string,
  pathname: string,
): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false
  }
  const match = /^\/api\/workflows\/([^/]+)(?:\/|$)/.exec(pathname)
  if (!match?.[1]) return false
  try {
    return PROTECTED_WORKFLOW_IDS.has(decodeURIComponent(match[1]))
  } catch {
    return false
  }
}
