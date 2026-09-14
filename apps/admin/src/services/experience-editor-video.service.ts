export type ExperienceEditorAuthoredDubSelector = {
  videoId: string
  languageId: string | null
  legacyStreamingUrl: string | null
}

export type ExperienceEditorDubLanguage = {
  id: string
  slug: string | null
  bcp47: string | null
  iso3: string | null
  name?: unknown
}

/** Scalar projection used before a selected Dub is hydrated. */
export type ExperienceEditorDubCandidate = {
  id: string
  videoId: string
  languageId: string | null
  language: ExperienceEditorDubLanguage | null
  hls: string | null
  dash: string | null
  share: string | null
  duration: number | null
  lengthInMilliseconds: bigint | null
  deletedAt: Date | null
  updatedAt: Date
  /** Editor eligibility intentionally does not depend on publication state. */
  published?: boolean
}

export type ExperienceEditorDubChoice = {
  key: string
  label: string
  languageId: string | null
  languageSlug: string | null
  bcp47: string | null
  iso3: string | null
  languageIdentity: string
  streamUrl: string
  duration: string
  durationSeconds: number | null
}

export type ExperienceEditorLanguageChip = {
  code: string
  flagUrl: string | null
}

export type ExperienceEditorDubInventoryState =
  | { status: "not-loaded" }
  | { status: "loading" }
  | {
      status: "loaded"
      choices: ExperienceEditorDubChoice[]
      nextCursor: string | null
    }
  | { status: "error"; message: string }

export const NOT_LOADED_EXPERIENCE_EDITOR_DUB_INVENTORY: Extract<
  ExperienceEditorDubInventoryState,
  { status: "not-loaded" }
> = {
  status: "not-loaded",
}

export const EMPTY_EXPERIENCE_EDITOR_DUB_INVENTORY: Extract<
  ExperienceEditorDubInventoryState,
  { status: "loaded" }
> = {
  status: "loaded",
  choices: [],
  nextCursor: null,
}

/** Compact cold-path contract. It never carries a complete Dub inventory. */
export type ExperienceEditorVideoSummary = {
  key: string
  id: string
  slug: string
  title: string
  description: string | null
  label: string | null
  labelLabel: string | null
  childCount: number
  isCollectionTarget: boolean
  sourceLabel: string
  sourceTone: "success" | "warning" | "danger" | "info" | "muted"
  dubs: string
  playableLanguageCount: number
  playableLanguageChips: ExperienceEditorLanguageChip[]
  updated: string
  duration: string
  durationSeconds: number | null
  previewImageUrl: string | null
  previewStreamUrl: string | null
  defaultDub: ExperienceEditorDubChoice | null
  authoredDubs: ExperienceEditorDubChoice[]
  dubInventory: ExperienceEditorDubInventoryState
  hasGrounding: boolean
  collectionPreviewItems: Array<{
    key: string
    title: string
    previewImageUrl: string | null
  }>
}

function compactText(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function editorDubStreamUrl(
  dub: Pick<ExperienceEditorDubCandidate, "hls" | "dash" | "share">,
) {
  return compactText(dub.hls) ?? compactText(dub.dash) ?? compactText(dub.share)
}

export function isExperienceEditorPlayableDub(
  dub: Pick<
    ExperienceEditorDubCandidate,
    "deletedAt" | "hls" | "dash" | "share"
  >,
) {
  return dub.deletedAt == null && editorDubStreamUrl(dub) != null
}

export function experienceEditorLanguageIdentity(
  dub: Pick<ExperienceEditorDubCandidate, "id" | "language" | "languageId">,
) {
  const language = dub.language
  const candidate =
    compactText(language?.slug)?.toLowerCase() ??
    compactText(language?.bcp47)?.toLowerCase() ??
    compactText(language?.iso3)?.toLowerCase() ??
    compactText(language?.id ?? dub.languageId)?.toLowerCase()

  return candidate ?? dub.id
}

function durationSecondsForDub(
  dub: Pick<ExperienceEditorDubCandidate, "duration" | "lengthInMilliseconds">,
) {
  if (dub.lengthInMilliseconds != null) {
    return Number(dub.lengthInMilliseconds / BigInt(1000))
  }
  return dub.duration
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "--:--"
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
}

function localizedLanguageName(value: unknown, locale: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const names = value as Record<string, unknown>
  const normalizedLocale = locale.trim().toLowerCase()
  const baseLocale = normalizedLocale.split("-")[0] ?? normalizedLocale

  for (const code of [normalizedLocale, baseLocale, "en"]) {
    const match = names[code]
    if (typeof match === "string" && match.trim()) return match.trim()
  }
  const fallback = Object.values(names).find(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  )
  return fallback?.trim() ?? null
}

function compareEditorDubCandidates(
  left: ExperienceEditorDubCandidate,
  right: ExperienceEditorDubCandidate,
) {
  const updatedDelta = right.updatedAt.getTime() - left.updatedAt.getTime()
  return updatedDelta || left.id.localeCompare(right.id)
}

export function createExperienceEditorDubChoice(
  dub: ExperienceEditorDubCandidate,
  locale: string,
): ExperienceEditorDubChoice | null {
  if (!isExperienceEditorPlayableDub(dub)) return null
  const streamUrl = editorDubStreamUrl(dub)
  if (!streamUrl) return null
  const durationSeconds = durationSecondsForDub(dub)

  return {
    key: dub.id,
    label:
      localizedLanguageName(dub.language?.name, locale) ??
      compactText(dub.language?.slug) ??
      compactText(dub.language?.bcp47) ??
      compactText(dub.language?.iso3) ??
      compactText(dub.language?.id ?? dub.languageId) ??
      `Dub ${dub.id}`,
    languageId: dub.language?.id ?? dub.languageId,
    languageSlug: dub.language?.slug ?? null,
    bcp47: dub.language?.bcp47 ?? null,
    iso3: dub.language?.iso3 ?? null,
    languageIdentity: experienceEditorLanguageIdentity(dub),
    streamUrl,
    duration: formatDuration(durationSeconds),
    durationSeconds,
  }
}

export function deduplicateExperienceEditorDubs(
  dubs: readonly ExperienceEditorDubCandidate[],
  locale: string,
) {
  const seen = new Set<string>()
  const choices: ExperienceEditorDubChoice[] = []
  for (const dub of [...dubs].sort(compareEditorDubCandidates)) {
    const choice = createExperienceEditorDubChoice(dub, locale)
    if (!choice || seen.has(choice.languageIdentity)) continue
    seen.add(choice.languageIdentity)
    choices.push(choice)
  }
  return choices
}

function localeMatchesDubLanguage(
  locale: string,
  dub: ExperienceEditorDubCandidate,
) {
  const normalizedLocale = compactText(locale)
    ?.toLowerCase()
    .replaceAll("_", "-")
  if (!normalizedLocale || !dub.language) return false
  const baseLocale = normalizedLocale.split("-")[0] ?? normalizedLocale
  const languageCodes = [
    dub.language.bcp47,
    dub.language.slug,
    dub.language.iso3,
  ]
    .map((code) => compactText(code)?.toLowerCase() ?? null)
    .filter((code): code is string => code != null)
    .map((code) => code.replaceAll("_", "-"))

  return (
    languageCodes.includes(normalizedLocale) ||
    languageCodes.includes(baseLocale) ||
    languageCodes.some((code) => code.startsWith(`${baseLocale}-`))
  )
}

/**
 * Resolves the one Dub whose URL, duration and persisted selector drive the
 * editor. This function is read-only: background resolution never mutates the
 * authored block or its clip range.
 */
export function resolveExperienceEditorDub(
  dubs: readonly ExperienceEditorDubCandidate[],
  locale: string,
  selector: ExperienceEditorAuthoredDubSelector | null,
) {
  const playable = [...dubs]
    .filter(isExperienceEditorPlayableDub)
    .filter((dub) => !selector || dub.videoId === selector.videoId)
    .sort(compareEditorDubCandidates)
  if (playable.length === 0) return null

  if (selector?.languageId) {
    const languageMatch = playable.find(
      (dub) =>
        dub.languageId === selector.languageId ||
        dub.language?.id === selector.languageId,
    )
    if (languageMatch) return languageMatch
  }

  if (selector?.legacyStreamingUrl) {
    const legacyUrl = selector.legacyStreamingUrl.trim()
    const streamMatch = playable.find((dub) =>
      [dub.hls, dub.dash, dub.share].some(
        (stream) => compactText(stream) === legacyUrl,
      ),
    )
    if (streamMatch) return streamMatch
  }

  return (
    playable.find((dub) => localeMatchesDubLanguage(locale, dub)) ??
    playable.find((dub) => compactText(dub.hls) != null) ??
    playable.find(
      (dub) => compactText(dub.dash) != null || compactText(dub.share) != null,
    ) ??
    null
  )
}

export type ExperienceEditorVideoSelectionFields = {
  languageId?: string | null
  streamingUrl?: string | null
  clipStartSeconds?: number
  clipEndSeconds?: number
}

type UpdatedExperienceEditorVideoSelection<
  T extends ExperienceEditorVideoSelectionFields,
> = Omit<T, keyof ExperienceEditorVideoSelectionFields> &
  ExperienceEditorVideoSelectionFields

/** Only an explicit language change is allowed to reset authored trim bounds. */
export function applyIntentionalExperienceEditorDubChoice<
  T extends ExperienceEditorVideoSelectionFields,
>(
  selection: T,
  choice: ExperienceEditorDubChoice,
): UpdatedExperienceEditorVideoSelection<T> {
  const sameLanguage =
    choice.languageId != null
      ? compactText(selection.languageId) === choice.languageId
      : compactText(selection.streamingUrl) === choice.streamUrl
  if (sameLanguage) return selection

  return {
    ...selection,
    languageId: choice.languageId,
    streamingUrl: undefined,
    clipStartSeconds: 0,
    clipEndSeconds: undefined,
  }
}
