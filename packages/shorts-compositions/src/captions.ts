// Pure caption-page helpers shared by the manager caption editor and the
// render-props resolution step. Imported via the "./captions" subpath
// export — no React, no "remotion" core. Importing the Caption TYPE and the
// createTikTokStyleCaptions function from @remotion/captions is allowed:
// that package is dependency-free and browser/node-safe.
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions"

import type { CaptionPage } from "./schema"

const DEFAULT_COMBINE_TOKENS_WITHIN_MS = 1200

export type BuildCaptionPagesOptions = {
  combineTokensWithinMilliseconds?: number
}

// Whisper word captions -> TikTok-style pages in our captionPageSchema
// shape. Token text carries leading spaces (whitespace is the delimiter
// between words) — they are preserved verbatim.
export const buildCaptionPages = (
  captions: Caption[],
  options?: BuildCaptionPagesOptions,
): CaptionPage[] => {
  const { pages } = createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds:
      options?.combineTokensWithinMilliseconds ??
      DEFAULT_COMBINE_TOKENS_WITHIN_MS,
  })
  return pages.map((page) => ({
    text: page.text,
    startMs: page.startMs,
    durationMs: page.durationMs,
    tokens: page.tokens.map((token) => ({
      text: token.text,
      fromMs: token.fromMs,
      toMs: token.toMs,
    })),
  }))
}

const assertPageIndex = (pages: CaptionPage[], pageIndex: number): void => {
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= pages.length
  ) {
    throw new RangeError(
      `pageIndex ${pageIndex} out of range (0..${pages.length - 1})`,
    )
  }
}

const assertTokenIndex = (page: CaptionPage, tokenIndex: number): void => {
  if (
    !Number.isInteger(tokenIndex) ||
    tokenIndex < 0 ||
    tokenIndex >= page.tokens.length
  ) {
    throw new RangeError(
      `tokenIndex ${tokenIndex} out of range (0..${page.tokens.length - 1})`,
    )
  }
}

// Matches createTikTokStyleCaptions' page-text convention: concatenated
// token texts with leading whitespace trimmed (page-initial tokens carry no
// leading space; deleting the first token must not leave one behind).
const pageText = (tokens: CaptionPage["tokens"]): string =>
  tokens
    .map((token) => token.text)
    .join("")
    .trimStart()

// Immutable token text edit. Timings are preserved; the leading-space
// convention is preserved too — if the original token text started with a
// space, the replacement keeps one.
export const applyTokenTextEdit = (
  pages: CaptionPage[],
  pageIndex: number,
  tokenIndex: number,
  newText: string,
): CaptionPage[] => {
  assertPageIndex(pages, pageIndex)
  const page = pages[pageIndex]
  assertTokenIndex(page, tokenIndex)
  const original = page.tokens[tokenIndex]
  const text =
    original.text.startsWith(" ") && !newText.startsWith(" ")
      ? ` ${newText}`
      : newText
  const tokens = page.tokens.map((token, index) =>
    index === tokenIndex ? { ...token, text } : token,
  )
  return pages.map((existing, index) =>
    index === pageIndex
      ? { ...existing, text: pageText(tokens), tokens }
      : existing,
  )
}

// Immutable token delete. Page text is recomputed from the remaining
// tokens; if the page empties, it is dropped. Page start/duration are
// otherwise unchanged.
export const deleteToken = (
  pages: CaptionPage[],
  pageIndex: number,
  tokenIndex: number,
): CaptionPage[] => {
  assertPageIndex(pages, pageIndex)
  const page = pages[pageIndex]
  assertTokenIndex(page, tokenIndex)
  const tokens = page.tokens.filter((_, index) => index !== tokenIndex)
  if (tokens.length === 0) {
    return pages.filter((_, index) => index !== pageIndex)
  }
  return pages.map((existing, index) =>
    index === pageIndex
      ? { ...existing, text: pageText(tokens), tokens }
      : existing,
  )
}

// Immutable page delete.
export const deletePage = (
  pages: CaptionPage[],
  pageIndex: number,
): CaptionPage[] => {
  assertPageIndex(pages, pageIndex)
  return pages.filter((_, index) => index !== pageIndex)
}

// Index of the token active at timeMs: token.fromMs <= timeMs < token.toMs
// (inclusive from, exclusive to), or -1 when no token is active.
export const activeTokenIndex = (page: CaptionPage, timeMs: number): number =>
  page.tokens.findIndex(
    (token) => token.fromMs <= timeMs && timeMs < token.toMs,
  )
