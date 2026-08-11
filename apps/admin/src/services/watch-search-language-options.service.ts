import type { Prisma } from "@prisma/client"

import { prisma } from "@/db/client"

import {
  cachedBoundedTtlValue,
  type BoundedTtlCache,
} from "./bounded-ttl-promise-cache"

export type WatchSearchLanguageOption = Readonly<{
  label: string
  value: string
}>

export type WatchSearchLanguageSelection = Readonly<{
  targetLanguageSlug: string
  locale: string
}>

type WatchSearchLanguageCatalog = Readonly<{
  options: readonly WatchSearchLanguageOption[]
}>

const LANGUAGE_OPTIONS_CACHE_TTL_MS = 5 * 60 * 1_000
const languageOptionsCaches = new WeakMap<
  object,
  BoundedTtlCache<WatchSearchLanguageCatalog>
>()
const languageOptionCollator = new Intl.Collator("en", {
  sensitivity: "base",
})

function nameFrom(value: Prisma.JsonValue, englishLocale?: string) {
  if (englishLocale?.trim()) return englishLocale.trim()
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    return null
  }

  const names = value as Record<string, Prisma.JsonValue>
  for (const key of ["en", "native"]) {
    const name = names[key]
    if (typeof name === "string" && name.trim()) return name.trim()
  }

  return (
    Object.values(names)
      .find(
        (name): name is string =>
          typeof name === "string" && name.trim() !== "",
      )
      ?.trim() ?? null
  )
}

async function loadWatchSearchLanguageCatalogUncached() {
  const languages = await prisma.language.findMany({
    where: {
      deletedAt: null,
      bcp47: { not: null },
      slug: { not: null },
    },
    select: {
      bcp47: true,
      slug: true,
      name: true,
      locales: {
        where: { deletedAt: null, locale: "en" },
        select: { value: true },
        take: 1,
      },
    },
  })

  const options = languages
    .flatMap(({ bcp47, slug, name, locales }) => {
      if (!bcp47 || !slug) return []
      const languageName = nameFrom(name, locales[0]?.value) ?? slug
      return [
        {
          label: `${languageName} — ${bcp47}`,
          value: slug,
        },
      ]
    })
    .sort((left, right) =>
      languageOptionCollator.compare(left.label, right.label),
    )

  return { options }
}

function loadWatchSearchLanguageCatalog() {
  return cachedBoundedTtlValue({
    cacheByOwner: languageOptionsCaches,
    owner: prisma,
    key: "active-languages",
    ttlMs: LANGUAGE_OPTIONS_CACHE_TTL_MS,
    maxEntries: 1,
    loader: loadWatchSearchLanguageCatalogUncached,
  })
}

export async function loadWatchSearchLanguageOptions(): Promise<
  readonly WatchSearchLanguageOption[]
> {
  return (await loadWatchSearchLanguageCatalog()).options
}

export async function resolveWatchSearchLanguageSelection(
  slug: string,
): Promise<WatchSearchLanguageSelection | null> {
  const language = await prisma.language.findFirst({
    where: {
      slug,
      deletedAt: null,
      bcp47: { not: null },
    },
    select: {
      slug: true,
      bcp47: true,
    },
  })
  if (!language?.slug || !language.bcp47) return null
  return {
    targetLanguageSlug: language.slug,
    locale: language.bcp47,
  }
}
