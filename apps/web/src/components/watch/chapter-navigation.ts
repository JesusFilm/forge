export type WatchChapterNavigationIntent = {
  href: string
  languageSlug: string
  sourceVideoDocumentId: string
  targetVideoDocumentId: string
  title: string | null
  slug: string
  label: string | null
  posterUrl: string | null
}

export type WatchChapterOptimisticVisual = {
  title: string | null
  label: string | null
  posterUrl: string | null
  loading?: boolean
  transitionKey?: string | null
}

const WATCH_CHAPTER_POSTER_BRIDGE_STORAGE_KEY =
  "forge.watch.chapterPosterBridge"
const WATCH_CHAPTER_POSTER_BRIDGE_TTL_MS = 30_000

type WatchChapterPosterBridgeIntent = {
  href: string
  languageSlug: string
  targetVideoDocumentId: string
  createdAt: number
}

type WatchChapterPosterBridgeMatch = {
  languageSlug: string
  targetVideoDocumentId: string
  pathname?: string
  now?: number
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null

  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function readWatchChapterPosterBridgeIntent(): WatchChapterPosterBridgeIntent | null {
  const storage = getSessionStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(WATCH_CHAPTER_POSTER_BRIDGE_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<WatchChapterPosterBridgeIntent>
    if (
      typeof parsed.href !== "string" ||
      typeof parsed.languageSlug !== "string" ||
      typeof parsed.targetVideoDocumentId !== "string" ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt)
    ) {
      return null
    }

    return {
      href: parsed.href,
      languageSlug: parsed.languageSlug,
      targetVideoDocumentId: parsed.targetVideoDocumentId,
      createdAt: parsed.createdAt,
    }
  } catch {
    return null
  }
}

function clearWatchChapterPosterBridgeIntent() {
  const storage = getSessionStorage()
  if (!storage) return

  try {
    storage.removeItem(WATCH_CHAPTER_POSTER_BRIDGE_STORAGE_KEY)
  } catch {
    return
  }
}

function posterBridgeIntentMatches(
  intent: WatchChapterPosterBridgeIntent,
  {
    languageSlug,
    targetVideoDocumentId,
    pathname = typeof window === "undefined" ? "" : window.location.pathname,
    now = Date.now(),
  }: WatchChapterPosterBridgeMatch,
) {
  if (now - intent.createdAt > WATCH_CHAPTER_POSTER_BRIDGE_TTL_MS) {
    return false
  }
  if (intent.languageSlug !== languageSlug) return false
  if (intent.targetVideoDocumentId !== targetVideoDocumentId) return false

  let intentPathname: string
  try {
    intentPathname = new URL(
      intent.href,
      typeof window === "undefined" ? "http://localhost" : window.location.href,
    ).pathname
  } catch {
    return false
  }
  return pathname === intentPathname || pathname.endsWith(intentPathname)
}

export function writeWatchChapterPosterBridgeIntent(
  intent: WatchChapterNavigationIntent,
) {
  const storage = getSessionStorage()
  if (!storage) return

  const bridgeIntent: WatchChapterPosterBridgeIntent = {
    href: intent.href,
    languageSlug: intent.languageSlug,
    targetVideoDocumentId: intent.targetVideoDocumentId,
    createdAt: Date.now(),
  }

  try {
    storage.setItem(
      WATCH_CHAPTER_POSTER_BRIDGE_STORAGE_KEY,
      JSON.stringify(bridgeIntent),
    )
  } catch {
    return
  }
}

export function shouldUseWatchChapterPosterBridgeIntent(
  match: WatchChapterPosterBridgeMatch,
) {
  const intent = readWatchChapterPosterBridgeIntent()
  return intent != null && posterBridgeIntentMatches(intent, match)
}

export function consumeWatchChapterPosterBridgeIntent(
  match: WatchChapterPosterBridgeMatch,
) {
  const intent = readWatchChapterPosterBridgeIntent()
  if (!intent) return false

  const matched = posterBridgeIntentMatches(intent, match)
  const now = match.now ?? Date.now()
  if (matched || now - intent.createdAt > WATCH_CHAPTER_POSTER_BRIDGE_TTL_MS) {
    clearWatchChapterPosterBridgeIntent()
  }
  return matched
}
