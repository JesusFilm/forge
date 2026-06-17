import { env } from "../../config/env"
import type { SubtitleScriptureValidationFallbackReason } from "./types"

export type SubtitleBiblePassage = {
  provider: {
    name: "api_bible"
    bibleId: string
    language: string
    reference: string
    versionLabel?: string
    copyright?: string
  }
  referenceCount: number
  text: string
}

export type BiblePassageLookupResult =
  | { ok: true; passage: SubtitleBiblePassage }
  | { ok: false; reason: SubtitleScriptureValidationFallbackReason }

export type LoadBiblePassageInput = {
  targetLanguage: string
  references: string[]
  timeoutMs: number
  fetchImpl?: typeof fetch
  config?: BibleSourceConfig
}

const MAX_PASSAGE_TEXT_CHARS = 12_000

type BibleSourceConfig = {
  NODE_ENV?: string
  SUBTITLE_VALIDATION_BIBLE_PROVIDER?: string
  SUBTITLE_VALIDATION_BIBLE_MAP_JSON?: string
  API_BIBLE_API_KEY?: string
  API_BIBLE_BASE_URL: string
  API_BIBLE_ALLOWED_HOSTS?: string
}

const API_BIBLE_BOOK_IDS: Record<string, string> = {
  genesis: "GEN",
  exodus: "EXO",
  leviticus: "LEV",
  numbers: "NUM",
  deuteronomy: "DEU",
  joshua: "JOS",
  judges: "JDG",
  ruth: "RUT",
  "1samuel": "1SA",
  "2samuel": "2SA",
  "1kings": "1KI",
  "2kings": "2KI",
  "1chronicles": "1CH",
  "2chronicles": "2CH",
  ezra: "EZR",
  nehemiah: "NEH",
  esther: "EST",
  job: "JOB",
  psalm: "PSA",
  psalms: "PSA",
  proverbs: "PRO",
  ecclesiastes: "ECC",
  songofsolomon: "SNG",
  songofsongs: "SNG",
  isaiah: "ISA",
  jeremiah: "JER",
  lamentations: "LAM",
  ezekiel: "EZK",
  daniel: "DAN",
  hosea: "HOS",
  joel: "JOL",
  amos: "AMO",
  obadiah: "OBA",
  jonah: "JON",
  micah: "MIC",
  nahum: "NAM",
  habakkuk: "HAB",
  zephaniah: "ZEP",
  haggai: "HAG",
  zechariah: "ZEC",
  malachi: "MAL",
  matthew: "MAT",
  mark: "MRK",
  luke: "LUK",
  john: "JHN",
  acts: "ACT",
  romans: "ROM",
  "1corinthians": "1CO",
  "2corinthians": "2CO",
  galatians: "GAL",
  ephesians: "EPH",
  philippians: "PHP",
  colossians: "COL",
  "1thessalonians": "1TH",
  "2thessalonians": "2TH",
  "1timothy": "1TI",
  "2timothy": "2TI",
  titus: "TIT",
  philemon: "PHM",
  hebrews: "HEB",
  james: "JAS",
  "1peter": "1PE",
  "2peter": "2PE",
  "1john": "1JN",
  "2john": "2JN",
  "3john": "3JN",
  jude: "JUD",
  revelation: "REV",
}

function normalizeBookKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function normalizeApiBibleReference(
  reference: string,
): string | undefined {
  const match = reference
    .trim()
    .replace(/\s+/g, " ")
    .match(
      /^(.+?)\s+(\d{1,3})(?::(\d{1,3}))?(?:\s*[-–]\s*(\d{1,3})(?::(\d{1,3}))?)?$/,
    )
  if (!match) return undefined

  const bookId = API_BIBLE_BOOK_IDS[normalizeBookKey(match[1] ?? "")]
  if (!bookId) return undefined

  const chapter = match[2]
  const verseStart = match[3]
  const rangeStart = match[4]
  const rangeVerse = match[5]
  if (!chapter) return undefined
  if (!rangeStart) {
    return verseStart
      ? `${bookId}.${chapter}.${verseStart}`
      : `${bookId}.${chapter}`
  }
  if (!verseStart) {
    return rangeVerse
      ? `${bookId}.${chapter}-${bookId}.${rangeStart}.${rangeVerse}`
      : `${bookId}.${chapter}-${bookId}.${rangeStart}`
  }
  return rangeVerse
    ? `${bookId}.${chapter}.${verseStart}-${bookId}.${rangeStart}.${rangeVerse}`
    : `${bookId}.${chapter}.${verseStart}-${bookId}.${chapter}.${rangeStart}`
}

function parseBibleMap(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    return undefined
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === "string" &&
        typeof entry[1] === "string" &&
        entry[1].trim().length > 0,
    ),
  )
}

function lookupBibleId(
  bibleMap: Record<string, string>,
  targetLanguage: string,
): string | undefined {
  const normalized = targetLanguage.trim().toLowerCase()
  const baseLanguage = normalized.split("-")[0]
  return (
    bibleMap[targetLanguage] ?? bibleMap[normalized] ?? bibleMap[baseLanguage]
  )
}

function cleanPassageText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PASSAGE_TEXT_CHARS)
}

function apiBibleUrl(
  baseUrl: string,
  bibleId: string,
  passageId: string,
): URL | undefined {
  let url: URL
  try {
    url = new URL(
      `${baseUrl.replace(/\/$/, "")}/bibles/${encodeURIComponent(
        bibleId,
      )}/passages/${encodeURIComponent(passageId)}`,
    )
  } catch {
    return undefined
  }
  url.searchParams.set("content-type", "text")
  url.searchParams.set("include-notes", "false")
  url.searchParams.set("include-titles", "false")
  url.searchParams.set("include-chapter-numbers", "false")
  url.searchParams.set("include-verse-numbers", "false")
  return url
}

function csvSet(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "api.scripture.api.bible")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
}

function isApiBibleUrlAllowed(config: BibleSourceConfig, url: URL): boolean {
  if (config.NODE_ENV !== "production") {
    return true
  }

  const allowedHosts = csvSet(config.API_BIBLE_ALLOWED_HOSTS)
  return url.protocol === "https:" && allowedHosts.has(url.hostname)
}

export async function loadConfiguredBiblePassage({
  targetLanguage,
  references,
  timeoutMs,
  fetchImpl = fetch,
  config = env,
}: LoadBiblePassageInput): Promise<BiblePassageLookupResult> {
  if (config.SUBTITLE_VALIDATION_BIBLE_PROVIDER !== "api_bible") {
    return { ok: false, reason: "provider_config_missing" }
  }

  if (!config.API_BIBLE_API_KEY) {
    return { ok: false, reason: "provider_config_missing" }
  }

  const bibleMap = parseBibleMap(config.SUBTITLE_VALIDATION_BIBLE_MAP_JSON)
  if (!bibleMap) {
    return { ok: false, reason: "bible_mapping_missing" }
  }

  const bibleId = lookupBibleId(bibleMap, targetLanguage)
  if (!bibleId) {
    return { ok: false, reason: "bible_mapping_missing" }
  }

  const requestedReferences = references
    .map((reference) => reference.trim())
    .filter(Boolean)
  const normalizedReferences = requestedReferences.map(
    normalizeApiBibleReference,
  )
  if (
    normalizedReferences.length === 0 ||
    normalizedReferences.some((reference) => reference == null)
  ) {
    return { ok: false, reason: "reference_unsupported" }
  }
  const uniqueReferences = Array.from(new Set(normalizedReferences)) as string[]
  const passages: Array<{
    reference: string
    text: string
    copyright?: string
  }> = []

  for (const normalizedReference of uniqueReferences) {
    const url = apiBibleUrl(
      config.API_BIBLE_BASE_URL,
      bibleId,
      normalizedReference,
    )
    if (!url) {
      return { ok: false, reason: "provider_config_missing" }
    }
    if (!isApiBibleUrlAllowed(config, url)) {
      return { ok: false, reason: "provider_config_missing" }
    }

    let response: Response
    try {
      response = await fetchImpl(url, {
        headers: { "api-key": config.API_BIBLE_API_KEY },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      return { ok: false, reason: "provider_failed" }
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "provider_auth_failed" }
    }
    if (response.status === 404) {
      return { ok: false, reason: "reference_unsupported" }
    }
    if (response.status === 429) {
      return { ok: false, reason: "provider_rate_limited" }
    }
    if (!response.ok) {
      return { ok: false, reason: "provider_failed" }
    }

    const body = (await response.json().catch(() => null)) as {
      data?: {
        content?: unknown
        reference?: unknown
        copyright?: unknown
      }
    } | null
    const content = body?.data?.content
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, reason: "provider_invalid_output" }
    }
    passages.push({
      reference:
        typeof body?.data?.reference === "string"
          ? body.data.reference
          : normalizedReference,
      text: cleanPassageText(content),
      ...(typeof body?.data?.copyright === "string"
        ? { copyright: body.data.copyright.slice(0, 240) }
        : {}),
    })
  }
  const copyright = Array.from(
    new Set(passages.map((passage) => passage.copyright).filter(Boolean)),
  ).join("; ")

  return {
    ok: true,
    passage: {
      provider: {
        name: "api_bible",
        bibleId,
        language: targetLanguage,
        reference: passages.map((passage) => passage.reference).join(", "),
        ...(copyright ? { copyright: copyright.slice(0, 240) } : {}),
      },
      referenceCount: passages.length,
      text: passages
        .map((passage) => `[${passage.reference}]\n${passage.text}`)
        .join("\n\n")
        .slice(0, MAX_PASSAGE_TEXT_CHARS),
    },
  }
}

export const _internals = {
  normalizeBookKey,
  parseBibleMap,
  lookupBibleId,
  apiBibleUrl,
  cleanPassageText,
}
