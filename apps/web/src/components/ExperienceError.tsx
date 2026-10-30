import type { ComponentPropsWithoutRef, ReactNode } from "react"
import { useTranslations } from "next-intl"

type ExperienceErrorProps = {
  message: string
  // Rendered inside the same <main>, so a route error boundary can add its
  // retry control without nesting a second main landmark.
  children?: ReactNode
  // Lets a fallback that renders outside the page shell put the skip-link
  // target on this <main> instead of wrapping it in a second landmark.
  mainProps?: Pick<ComponentPropsWithoutRef<"main">, "id" | "tabIndex">
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

export function ExperienceError({
  message,
  children,
  mainProps,
}: ExperienceErrorProps) {
  const t = useTranslations("ExperienceError")
  const trimmed = message?.trim() || ""
  // Object.hasOwn check so the index access is type-honest under
  // `noUncheckedIndexedAccess`-off projects too — KNOWN_ERROR_KEYS
  // returns undefined for unknown inputs and the type system should
  // reflect that. Mirrors the LANGUAGE_BCP47_MAP pattern in locale.ts.
  const key = Object.hasOwn(KNOWN_ERROR_KEYS, trimmed)
    ? KNOWN_ERROR_KEYS[trimmed]
    : "unexpected"
  // A route boundary failure is not an experience load, so it reads as the
  // plain translated sentence instead of "Failed to load experience: …".
  const text =
    key === "pageLoadFailed"
      ? t("pageLoadFailed")
      : t("failedToLoad", { message: t(key) })
  return (
    <main {...mainProps} className="flex flex-col items-center outline-none">
      {/* Top padding mirrors the chrome's rem-sized header band, so the
          message starts below the fixed header even at 200% text (feat-774). */}
      <div className="flex min-h-[40vh] w-full flex-col items-center justify-center p-8 pt-[calc(5.5rem+env(safe-area-inset-top,0px))] md:pt-[calc(9rem+env(safe-area-inset-top,0px))]">
        {/* role="alert" announces the failure when a boundary swaps it in.
            red-400 keeps 4.5:1 on the black page and stone-900 boundary
            backgrounds (red-600 measured 4.40 and 3.67). */}
        <p role="alert" className="text-lg text-red-400">
          {text}
        </p>
      </div>
      {children}
    </main>
  )
}
