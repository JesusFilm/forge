/**
 * Pure codegen for Web's public Watch language namespace.
 *
 * Two generated artifacts derive from admin's `Language` inventory:
 *
 *   1. `apps/web/src/lib/language-bcp47-map.ts` — slug → BCP-47 value map
 *      that drives `<html lang>`, text direction, and the UI-catalog
 *      fallback chain (`slugToBcp47Tag` in `lib/locale.ts`).
 *   2. `packages/watch-url-policy/src/public-watch-language-slugs.ts` — the
 *      compact slug-only corpus every Forge client uses for URL-grammar
 *      disambiguation (`/watch/<content>.html/<language>.html` vs
 *      `/watch/<series>.html/<episode>.html`).
 *
 * The runtime route classifier no longer treats this corpus as complete: the
 * proxy and page also admit any audio slug the live Watch route manifest
 * knows (see `isWatchAudioLanguageSlug` in `lib/watch-route-manifest.ts`).
 * The corpus is still the synchronous fallback and the only source for the
 * BCP-47 projection, so it must be regenerated when admin publishes
 * languages — `scripts/generate-language-bcp47-map.ts` does that and its
 * `--check` mode reports drift.
 *
 * This module is fetch- and fs-free so it can be unit tested; the script
 * owns I/O.
 */

export type AdminLanguageRow = {
  slug: string | null
  bcp47: string | null
}

export type LanguageBcp47Map = Readonly<Record<string, string>>

export type SkippedLanguageRow = {
  row: AdminLanguageRow
  reason: "missing-slug" | "missing-bcp47" | "invalid-slug" | "invalid-bcp47"
}

export type LanguageBcp47MapBuild = {
  map: LanguageBcp47Map
  skipped: SkippedLanguageRow[]
}

export type LanguageCorpusDiff = {
  added: string[]
  removed: string[]
  changed: Array<{ slug: string; from: string; to: string }>
}

/**
 * Public Watch URL slugs that must be part of the slug-only corpus even if
 * admin's inventory ever drops them. Each entry pairs with an
 * `HTML_LANG_OVERRIDES` row in `lib/locale.ts` that supplies its `<html lang>`.
 */
export const PUBLIC_WATCH_LANGUAGE_SLUG_OVERRIDES: readonly string[] =
  Object.freeze(["spanish-latin-american"])

/** Admin caps `languages(limit:)` at 500 rows per page. */
export const ADMIN_LANGUAGES_PAGE_SIZE = 500

export const ADMIN_LANGUAGES_QUERY = /* GraphQL */ `
  query WebLanguageBcp47MapCodegen($limit: Int!, $offset: Int!) {
    languages(limit: $limit, offset: $offset) {
      slug
      bcp47
    }
  }
`

const PUBLIC_LANGUAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// Admin stores private-use subtags (`zh-x-Guiliu`, `ko-x-Hamgyongdo`) and
// region digits (`zh-CN-53-x-Kunming`). Private-use subtags exceed RFC 5646's
// 8-character limit in admin's data, so only the alphanumeric-subtag shape is
// enforced here; `normalizeBcp47Tag` in lib/locale.ts handles casing.
const BCP47_VALUE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*$/

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function buildLanguageBcp47Map(
  rows: readonly AdminLanguageRow[],
): LanguageBcp47MapBuild {
  const entries = new Map<string, string>()
  const skipped: SkippedLanguageRow[] = []

  for (const row of rows) {
    if (!row.slug) {
      skipped.push({ row, reason: "missing-slug" })
      continue
    }
    if (!row.bcp47) {
      skipped.push({ row, reason: "missing-bcp47" })
      continue
    }
    if (!PUBLIC_LANGUAGE_SLUG_PATTERN.test(row.slug)) {
      skipped.push({ row, reason: "invalid-slug" })
      continue
    }
    if (!BCP47_VALUE_PATTERN.test(row.bcp47)) {
      skipped.push({ row, reason: "invalid-bcp47" })
      continue
    }
    entries.set(row.slug, row.bcp47)
  }

  const map: Record<string, string> = {}
  for (const slug of [...entries.keys()].sort(compareCodePoints)) {
    map[slug] = entries.get(slug) as string
  }
  return { map: Object.freeze(map), skipped }
}

export function buildPublicWatchLanguageSlugs(
  map: LanguageBcp47Map,
  overrides: readonly string[] = PUBLIC_WATCH_LANGUAGE_SLUG_OVERRIDES,
): string[] {
  return [...new Set([...Object.keys(map), ...overrides])].sort(
    compareCodePoints,
  )
}

/**
 * Parse the slug → BCP-47 entries back out of a generated map source file so
 * `--check` can diff without importing a TypeScript module at runtime.
 */
export function parseLanguageBcp47MapSource(source: string): LanguageBcp47Map {
  const map: Record<string, string> = {}
  for (const match of source.matchAll(
    /^\s+(?:"([^"]+)"|([A-Za-z_$][\w$]*)): "([^"]+)",?$/gm,
  )) {
    const slug = match[1] ?? match[2]
    const bcp47 = match[3]
    if (slug && bcp47) map[slug] = bcp47
  }
  return Object.freeze(map)
}

export function parsePublicWatchLanguageSlugsSource(source: string): string[] {
  const match = source.match(/CORPUS = `([^`]*)`/)
  if (!match?.[1]) return []
  return match[1].split("\n").filter(Boolean)
}

export function diffLanguageCorpus(
  current: LanguageBcp47Map,
  next: LanguageBcp47Map,
): LanguageCorpusDiff {
  const added: string[] = []
  const removed: string[] = []
  const changed: LanguageCorpusDiff["changed"] = []

  for (const [slug, bcp47] of Object.entries(next)) {
    const before = current[slug]
    if (before === undefined) added.push(slug)
    else if (before !== bcp47) changed.push({ slug, from: before, to: bcp47 })
  }
  for (const slug of Object.keys(current)) {
    if (!(slug in next)) removed.push(slug)
  }

  return {
    added: added.sort(compareCodePoints),
    removed: removed.sort(compareCodePoints),
    changed: changed.sort((a, b) => compareCodePoints(a.slug, b.slug)),
  }
}

export function hasLanguageCorpusDrift(diff: LanguageCorpusDiff): boolean {
  return (
    diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0
  )
}

const IDENTIFIER_KEY_PATTERN = /^[A-Za-z_$][\w$]*$/

function renderObjectKey(key: string): string {
  return IDENTIFIER_KEY_PATTERN.test(key) ? key : JSON.stringify(key)
}

export type RenderLanguageBcp47MapOptions = {
  /** ISO date (YYYY-MM-DD) stamped into the header. */
  generatedOn: string
  skippedCount: number
}

export function renderLanguageBcp47MapSource(
  map: LanguageBcp47Map,
  options: RenderLanguageBcp47MapOptions,
): string {
  const entryCount = Object.keys(map).length
  const skippedNote =
    options.skippedCount === 0
      ? "no admin rows skipped"
      : `${options.skippedCount} admin rows skipped — missing or malformed slug/bcp47`
  const lines = [
    `// AUTOGENERATED from admin Language.bcp47 on ${options.generatedOn}`,
    `// ${entryCount} entries (${skippedNote}).`,
    "// Regenerate via: pnpm --filter @forge/web generate:language-bcp47-map",
    "// Drift check:    pnpm --filter @forge/web check:language-bcp47-map",
    "// (.github/workflows/watch-language-corpus-drift.yml runs it on a schedule).",
    "//",
    "// Maps the English-name kebab slug (admin Language.slug) used in /watch",
    "// URLs to admin's full BCP-47 tag. Consume via",
    "// slugToBcp47Primary() in lib/locale.ts — that helper extracts the",
    "// primary subtag (es-ES → es) for the generated UI-catalog fallback chain.",
    "//",
    "// The runtime route classifier also admits audio slugs from the live",
    "// Watch route manifest, so a stale copy of this file degrades <html lang>",
    "// and UI chrome for a new language — it must not 404 its URL.",
    "",
    "export const LANGUAGE_BCP47_MAP: Readonly<Record<string, string>> =",
    "  Object.freeze({",
    ...Object.entries(map).map(
      ([slug, bcp47]) =>
        `    ${renderObjectKey(slug)}: ${JSON.stringify(bcp47)},`,
    ),
    "  })",
    "",
  ]
  return lines.join("\n")
}

export function renderPublicWatchLanguageSlugsSource(
  slugs: readonly string[],
): string {
  const lines = [
    "/**",
    " * AUTOGENERATED from the public Language slugs represented by Web's admin",
    " * Language.bcp47 snapshot, plus public Watch URL overrides.",
    " *",
    " * Regenerate via: pnpm --filter @forge/web generate:language-bcp47-map",
    " * Drift check:    pnpm --filter @forge/web check:language-bcp47-map",
    " *",
    " * Keep this compact slug-only corpus in the dependency-free URL package so",
    " * every Forge client can make the same language-home collision decision",
    " * without bundling the full slug-to-BCP-47 value map.",
    " *",
    " * This corpus is a synchronous fallback, not the route authority: Web's",
    " * proxy and page also admit any audio slug the live Watch route manifest",
    " * lists (apps/web/src/lib/watch-route-manifest.ts).",
    " *",
    " * Alignment with the BCP-47 map is checked by",
    " * apps/web/src/lib/locale.test.ts.",
    " */",
    `const PUBLIC_WATCH_LANGUAGE_SLUG_CORPUS = \`${slugs.join("\n")}\``,
    "",
    "export const PUBLIC_WATCH_LANGUAGE_SLUGS: ReadonlySet<string> = new Set(",
    '  PUBLIC_WATCH_LANGUAGE_SLUG_CORPUS.split("\\n"),',
    ")",
    "",
  ]
  return lines.join("\n")
}

export type AdminLanguagesPage = {
  data?: { languages?: AdminLanguageRow[] | null } | null
  errors?: Array<{ message?: string }>
}

export type FetchAdminLanguagesOptions = {
  adminGraphqlUrl: string
  fetchImpl?: typeof fetch
  pageSize?: number
}

/**
 * Page through admin's public `languages` query. Stops on the first short
 * page. The query is `authScopes: { public: true }` in admin, so no bearer
 * is sent — the generator never needs a secret.
 */
export async function fetchAdminLanguages(
  options: FetchAdminLanguagesOptions,
): Promise<AdminLanguageRow[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const pageSize = options.pageSize ?? ADMIN_LANGUAGES_PAGE_SIZE
  const rows: AdminLanguageRow[] = []

  for (let offset = 0; ; offset += pageSize) {
    const response = await fetchImpl(options.adminGraphqlUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: ADMIN_LANGUAGES_QUERY,
        variables: { limit: pageSize, offset },
      }),
    })
    if (!response.ok) {
      throw new Error(
        `admin languages query failed: HTTP ${response.status} at offset ${offset}`,
      )
    }
    const page = (await response.json()) as AdminLanguagesPage
    if (page.errors?.length) {
      throw new Error(
        `admin languages query returned errors: ${page.errors
          .map((error) => error.message ?? "unknown")
          .join("; ")}`,
      )
    }
    const languages = page.data?.languages ?? []
    rows.push(...languages)
    if (languages.length < pageSize) break
  }

  return rows
}
