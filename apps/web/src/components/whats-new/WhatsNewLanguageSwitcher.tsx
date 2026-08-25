"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUpRight, Languages } from "lucide-react"

import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import {
  languageInventoryPath,
  languagesIndexPath,
  tryAsLocaleSlug,
} from "@/lib/routes"
import { cn } from "@/lib/utils"
import type { WatchLanguageInventorySwitcherLanguage } from "@/lib/watch-language-inventory"

type WhatsNewLanguageSwitcherProps = {
  allLanguagesLabel: string
  className?: string
  currentSlug: string
  label: string
  languages: WatchLanguageInventorySwitcherLanguage[]
}

/**
 * The `/watch/{lang}.html/videos` language switcher, reused here so a
 * partner or non-English reader can leave this English announcement for
 * the full video collection in their own language.
 *
 * Two deliberate differences from `LanguageCollectionSwitcher`:
 * the item-count badge is dropped (this page is not a collection, so
 * there is no count to state), and re-selecting the current language is
 * NOT a no-op — from here even `english` is a real destination.
 */
export function WhatsNewLanguageSwitcher({
  allLanguagesLabel,
  className,
  currentSlug,
  label,
  languages,
}: WhatsNewLanguageSwitcherProps) {
  const router = useRouter()

  const options = useMemo<LanguageComboboxOption[]>(
    () =>
      languages.map((language) => ({
        slug: language.slug,
        name: language.languageName,
        nativeName: language.nativeName,
        bcp47: language.bcp47,
      })),
    [languages],
  )

  function handleLanguageChange(slug: string) {
    const lang = tryAsLocaleSlug(slug)
    if (!lang) return
    router.push(languageInventoryPath(lang))
  }

  return (
    <div
      className={cn(
        "w-full max-w-md rounded-2xl border border-white/10 bg-stone-950/45 p-4 text-left text-stone-100 shadow-2xl shadow-black/25 backdrop-blur",
        className,
      )}
      data-testid="whats-new-language-switcher"
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-amber-100">
          <Languages className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 text-xs font-bold tracking-[0.18em] text-stone-300 uppercase">
          {label}
        </span>
      </div>

      <LanguageCombobox
        options={options}
        value={currentSlug}
        onChange={handleLanguageChange}
        placeholder={label}
      />

      <Link
        href={languagesIndexPath()}
        data-testid="whats-new-all-languages-link"
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-300 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-white/70 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-4"
      >
        {allLanguagesLabel}
        <ArrowUpRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  )
}
