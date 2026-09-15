"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Languages } from "lucide-react"

import {
  LanguageCombobox,
  type LanguageComboboxOption,
} from "@/components/watch/LanguageCombobox"
import { languageInventoryPath, tryAsLocaleSlug } from "@/lib/routes"
import { cn } from "@/lib/utils"
import type { WatchLanguageInventorySwitcherLanguage } from "@/lib/watch-language-inventory"

type WhatsNewLanguageSwitcherProps = {
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
 *
 * Renders as a bare label plus the control: no frame, and no link to the
 * browse-all-languages index. Both were removed on request.
 *
 * KNOWN GAP that removing the link opened, recorded because nothing in the
 * happy path shows it: `resolveWatchLanguageSwitcherOptions` degrades to the
 * current language alone when Admin is unreachable, and this page is static
 * with a one-hour revalidate — so a bad build bakes a one-option combobox
 * for an hour, and the index link was the only exit from it. Restoring an
 * escape for that case alone would be `languages.length <= 1 && <Link …>`.
 */
export function WhatsNewLanguageSwitcher({
  className,
  currentSlug,
  label,
  languages,
}: WhatsNewLanguageSwitcherProps) {
  const router = useRouter()

  const currentLanguageName = useMemo(
    () =>
      languages.find((language) => language.slug === currentSlug)
        ?.languageName ?? null,
    [currentSlug, languages],
  )

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
      className={cn("w-full max-w-md text-left text-stone-100", className)}
      data-testid="whats-new-language-switcher"
    >
      <span className="mb-3 block text-xs font-bold tracking-[0.18em] text-stone-300 uppercase">
        {label}
      </span>

      <LanguageCombobox
        options={options}
        value={currentSlug}
        onChange={handleLanguageChange}
        placeholder={label}
        /* Pill of the same height as the feedback button beside it, so the
           two line up when the row aligns to its baseline. The shared
           trigger is `h-16 rounded-2xl`, sized for the collection pages
           where it stands alone.

           Important modifiers because `LanguageCombobox` CONCATENATES this
           onto its own class string rather than merging it through `cn`, so
           a plain `h-12` just ties with the base `h-16` on specificity and
           loses on stylesheet order. `FeedbackModal` works around the same
           thing the same way. */
        triggerClassName="h-12! min-h-12! rounded-full! px-5!"
        /* Replaces the two-letter code disc. A code badge answers "which
           language is this" for a reader scanning a list of them; here
           there is one, already named in words beside it, so the disc was
           restating the word next to it inside a heavier circle. */
        triggerContent={
          <>
            <span className="flex min-w-0 items-center gap-3">
              <Languages
                aria-hidden
                className="h-5 w-5 shrink-0 text-white/55"
              />
              <span className="block truncate leading-tight">
                {currentLanguageName ?? label}
              </span>
            </span>
            <ChevronDown
              aria-hidden
              className="h-5 w-5 shrink-0 text-white/55"
            />
          </>
        }
      />
    </div>
  )
}
