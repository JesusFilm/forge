export const HTML_SUFFIX = ".html"

export const HTML_SUFFIX_REGEX = /\.html$/i

export function stripHtmlSuffix(segment: string): string {
  return segment.replace(HTML_SUFFIX_REGEX, "")
}

export function hasHtmlSuffix(segment: string): boolean {
  return HTML_SUFFIX_REGEX.test(segment)
}

export function appendHtmlSuffix(segment: string): string {
  return hasHtmlSuffix(segment) ? segment : `${segment}${HTML_SUFFIX}`
}
