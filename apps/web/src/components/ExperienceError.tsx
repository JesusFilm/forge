import { useTranslations } from "next-intl"

type ExperienceErrorProps = {
  message: string
}

// Map known upstream error strings (matched verbatim) to translation
// key suffixes under the ExperienceError namespace. Caller passes the
// raw upstream string; we look up the friendly copy via t().
const KNOWN_ERROR_KEYS: Record<string, string> = {
  "GraphQL URL not configured": "notConfigured",
  "No experience found": "noContent",
  "Homepage experience must not be marked as template.":
    "homepageMisconfigured",
  "Default template experience must be marked as template.":
    "defaultTemplateMisconfigured",
  "Response not successful: Received status code 401": "authFailed",
  "Missing or invalid credentials": "authFailed",
  "Something went wrong loading this page.": "pageLoadFailed",
}

export function ExperienceError({ message }: ExperienceErrorProps) {
  const t = useTranslations("ExperienceError")
  const trimmed = message?.trim() || ""
  // Object.hasOwn check so the index access is type-honest under
  // `noUncheckedIndexedAccess`-off projects too — KNOWN_ERROR_KEYS
  // returns undefined for unknown inputs and the type system should
  // reflect that. Mirrors the LANGUAGE_BCP47_MAP pattern in locale.ts.
  const friendly = Object.hasOwn(KNOWN_ERROR_KEYS, trimmed)
    ? t(KNOWN_ERROR_KEYS[trimmed])
    : t("unexpected")
  return (
    <main className="flex min-h-[40vh] flex-col items-center justify-center p-8">
      <p className="text-lg text-red-600">
        {t("failedToLoad", { message: friendly })}
      </p>
    </main>
  )
}
