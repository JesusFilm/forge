/**
 * SAFE construction of local paths for offline media/subtitles/posters. Slug and
 * rendition documentId come from admin data, so every dynamic segment is sanitized
 * (separators, `..`, control bytes) BEFORE concatenation — never escapes the root.
 */

/**
 * Reduce one dynamic path segment to a filesystem-safe token: only
 * `[A-Za-z0-9._-]` survive (else `_`), and `""`/`"."`/`".."` collapse to `_` so a
 * segment can never act as a separator or parent-directory traversal.
 */
export function sanitizeSegment(raw: string): string {
  let safe = ""
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    safe += /[A-Za-z0-9._-]/.test(ch) ? ch : "_"
  }
  if (safe === "" || safe === "." || safe === "..") return "_"
  return safe
}

function rootWithSlash(root: string): string {
  return root.endsWith("/") ? root : `${root}/`
}

/** Join sanitized segments under the offline root. */
export function joinUnderRoot(root: string, ...segments: string[]): string {
  return rootWithSlash(root) + segments.map(sanitizeSegment).join("/")
}

/** Committed (verified, playable) media path for a rendition of a video. */
export function buildCommittedPath(
  root: string,
  videoSlug: string,
  renditionDocumentId: string,
): string {
  return joinUnderRoot(
    root,
    videoSlug,
    `${sanitizeSegment(renditionDocumentId)}.mp4`,
  )
}

/**
 * In-progress media path. The per-attempt `nonce` keeps a pending download from
 * sharing a path with the committed copy (so a same-rendition swap can't clobber
 * the original); the leading dot marks it a partial for launch reconciliation.
 */
export function buildPendingPath(
  root: string,
  videoSlug: string,
  nonce: string,
): string {
  return joinUnderRoot(
    root,
    videoSlug,
    `.pending-${sanitizeSegment(nonce)}.mp4`,
  )
}

/** Local subtitle (VTT) path for a chosen language of a video. */
export function buildSubtitlePath(
  root: string,
  videoSlug: string,
  languageSlug: string,
): string {
  return joinUnderRoot(root, videoSlug, `${sanitizeSegment(languageSlug)}.vtt`)
}

/** Local poster path for a video. */
export function buildPosterPath(root: string, videoSlug: string): string {
  return joinUnderRoot(root, videoSlug, "poster.jpg")
}
