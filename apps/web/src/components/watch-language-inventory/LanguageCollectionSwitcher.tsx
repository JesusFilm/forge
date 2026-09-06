"use client"

import { cloneElement, isValidElement, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Languages } from "lucide-react"

import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import { languageInventoryPath, tryAsLocaleSlug } from "@/lib/routes"
import { cn } from "@/lib/utils"
import type { WatchLanguageInventorySwitcherLanguage } from "@/lib/watch-language-inventory"
import { englishAssistAttributes } from "./english-assist"

type LanguageCollectionSwitcherProps = {
  className?: string
  currentLanguageName: string
  currentNativeName: string | null
  currentSlug: string
  languages: WatchLanguageInventorySwitcherLanguage[]
  totalItems: number
}

export function LanguageCollectionSwitcher({
  className,
  currentLanguageName,
  currentNativeName,
  currentSlug,
  languages,
  totalItems,
}: LanguageCollectionSwitcherProps) {
  const router = useRouter()
  const t = useTranslations("LanguageInventory")
  const languageOptions = useMemo<LanguageComboboxOption[]>(() => {
    const source =
      languages.length > 0
        ? languages
        : [
            {
              slug: currentSlug,
              languageName: currentLanguageName,
              nativeName: currentNativeName,
              bcp47: null,
            },
          ]
    const bySlug = new Map<string, WatchLanguageInventorySwitcherLanguage>()

    bySlug.set(currentSlug, {
      slug: currentSlug,
      languageName: currentLanguageName,
      nativeName: currentNativeName,
      bcp47: null,
    })

    for (const language of source) {
      bySlug.set(language.slug, language)
    }

    return [...bySlug.values()].map((language) => ({
      slug: language.slug,
      name: language.languageName,
      nativeName: language.nativeName,
      bcp47: language.bcp47,
    }))
  }, [currentLanguageName, currentNativeName, currentSlug, languages])

  function handleLanguageChange(slug: string) {
    if (slug === currentSlug) return

    const lang = tryAsLocaleSlug(slug)
    if (!lang) return

    router.push(languageInventoryPath(lang))
  }

  return (
    <div
      className={cn(
        // No outer border: the combobox inside carries its own, and the two
        // nested outlines read as a box in a box. Background, padding, and
        // shadow still group the header row with the picker.
        "w-full max-w-md rounded-2xl bg-stone-950/45 p-4 text-stone-100 shadow-2xl shadow-black/25 backdrop-blur",
        className,
      )}
      data-testid="language-collection-switcher"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-amber-100">
            <Languages className="h-4 w-4" aria-hidden />
          </span>
          <span
            className="min-w-0 text-sm sm:text-xs leading-5 font-medium tracking-media-label text-stone-300 uppercase"
            {...englishAssistAttributes("labelLanguageCollection")}
          >
            {t("languageCollection")}
          </span>
        </div>
        <span
          className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-sm sm:text-xs font-medium text-stone-300"
          {...englishAssistAttributes("labelItemCount")}
        >
          {t("itemCount", { count: totalItems })}
        </span>
      </div>

      <LanguageCombobox
        options={languageOptions}
        value={currentSlug}
        onChange={handleLanguageChange}
        placeholder={t("languageCollection")}
        triggerWrapper={(trigger) =>
          isValidElement<Record<string, unknown>>(trigger)
            ? cloneElement(trigger, englishAssistAttributes("chooseLanguage"))
            : trigger
        }
      />
    </div>
  )
}
