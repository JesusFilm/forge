import type { Principal } from "@/auth/principal"
import {
  ExperienceDuplicationError,
  ForbiddenError,
  NotFoundError,
} from "@/services/errors"
import type { ExperienceService } from "@/services/experience.service"

type DuplicateExperience = ExperienceService["duplicate"]

export async function duplicateExperienceForEditor({
  duplicate,
  user,
  sourceExperienceId,
  selectedLocale,
  revalidate,
}: {
  duplicate: DuplicateExperience
  user: Principal
  sourceExperienceId: string
  selectedLocale: string
  revalidate: () => void
}) {
  try {
    const duplicated = await duplicate({
      input: { id: sourceExperienceId },
      user,
    })
    const duplicatedLocale =
      duplicated.locales.find((locale) => locale.locale === selectedLocale) ??
      duplicated.locales[0]
    if (!duplicatedLocale) {
      return {
        ok: false as const,
        error: "The duplicated Experience has no locales.",
      }
    }

    revalidate()
    return {
      ok: true as const,
      href: `/dashboard/experiences/${duplicated.id}?locale=${duplicatedLocale.locale}`,
    }
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return {
        ok: false as const,
        error: "You do not have permission to duplicate this Experience.",
      }
    }
    if (error instanceof NotFoundError) {
      return {
        ok: false as const,
        error: "This Experience is no longer available.",
      }
    }
    if (error instanceof ExperienceDuplicationError) {
      return { ok: false as const, error: error.message }
    }
    return { ok: false as const, error: "Unable to duplicate Experience." }
  }
}
