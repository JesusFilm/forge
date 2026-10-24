/**
 * Validate a local `file://` media URI for offline playback ({@link ./validateUrl}
 * blocks `file:`, Mux HTTPS only). Pure (root injected); accepts ONLY a `file:`
 * URI normalizing inside that root — defeats `..`, percent-encoded, UNC, null-byte.
 */

/** Resolve `.`/`..` segments in a POSIX-style path. */
function resolveDotSegments(path: string): string {
  const isAbsolute = path.startsWith("/")
  const out: string[] = []
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return (isAbsolute ? "/" : "") + out.join("/")
}

/** True if the string contains a null byte or any C0 control character. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true
  }
  return false
}

/**
 * Reduce a `file:` URI or plain path to a normalized absolute path
 * (percent-decoded, dot segments resolved). Null if not a usable local path:
 * wrong scheme, non-empty host, bad encoding, or a null/control byte.
 */
function normalizeLocalPath(value: string): string | null {
  let rawPath: string

  if (value.startsWith("file:")) {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return null
    }
    // A local file has no authority component; `file://host/...` is a remote
    // UNC reference and must be rejected.
    if (parsed.host !== "") return null
    rawPath = parsed.pathname
  } else if (value.startsWith("/")) {
    rawPath = value
  } else {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  // Reject null bytes and other control characters that could truncate or
  // confuse downstream filesystem calls.
  if (hasControlChar(decoded)) return null

  return resolveDotSegments(decoded)
}

/**
 * True only when `uri` is a local `file:` URI inside `allowedRoot`.
 *
 * @param uri         the candidate media/subtitle URI
 * @param allowedRoot the offline-download root (a `file://` URI or a plain
 *                    absolute path; trailing slash optional)
 */
export function validateLocalMediaUrl(
  uri: string | null | undefined,
  allowedRoot: string | null | undefined,
): boolean {
  if (!uri || !allowedRoot) return false
  if (!uri.startsWith("file:")) return false

  const path = normalizeLocalPath(uri)
  const root = normalizeLocalPath(allowedRoot)
  if (path == null || root == null) return false

  // Compare against a root that ends in exactly one separator so a sibling
  // directory sharing the prefix (".../downloads-evil") cannot match
  // (".../downloads/").
  const rootWithSlash = root.endsWith("/") ? root : `${root}/`
  return `${path}/`.startsWith(rootWithSlash)
}
