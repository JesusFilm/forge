import type { ReactNode } from "react"
import type { Route } from "next"
import Link from "next/link"

import { LanguageGlobe } from "@/components/sections/LanguageGlobe"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { cn } from "@/lib/utils"

export type LanguageGlobeSectionAction = {
  href: Route
  icon?: ReactNode
  label: string
  variant?: "primary" | "secondary"
}

type LanguageGlobeSectionProps = {
  actions?: readonly LanguageGlobeSectionAction[]
  actionsLabel?: string
  children?: ReactNode
  className?: string
  description?: ReactNode
  eyebrow?: ReactNode
  globeClassName?: string
  headingId: string
  headingLevel?: "h1" | "h2"
  sectionKey?: string
  title: ReactNode
  variant?: "experience" | "not-found"
  watermark?: ReactNode
}

const actionBaseClasses =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-bold text-white transition focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:h-14 sm:px-6 sm:text-base"

export function LanguageGlobeSection({
  actions = [],
  actionsLabel,
  children,
  className,
  description,
  eyebrow,
  globeClassName,
  headingId,
  headingLevel = "h2",
  sectionKey,
  title,
  variant = "experience",
  watermark,
}: LanguageGlobeSectionProps) {
  const Heading = headingLevel
  const isNotFound = variant === "not-found"

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "relative isolate min-h-svh w-full overflow-hidden bg-[#09090b] text-white",
        className,
      )}
      data-language-globe-section={variant}
      data-section-key={sectionKey}
    >
      <div
        className={cn(
          WATCH_PAGE_CONTENT_CLASSES,
          "relative z-10 pb-[6px]",
          isNotFound
            ? "pt-[calc(env(safe-area-inset-top,0px)+7rem)] sm:pt-[calc(env(safe-area-inset-top,0px)+8rem)]"
            : "pt-20 sm:pt-24 lg:pt-28",
        )}
      >
        <div
          className="relative overflow-hidden rounded-[1.05rem] border border-white/15 bg-[#09090b]"
          data-testid="language-globe-surface"
        >
          <div className="relative z-10 px-6 pt-8 sm:px-10 sm:pt-10 lg:px-12 lg:pt-12">
            {watermark ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-4 -z-10 -translate-y-1/2 text-[clamp(9rem,34vw,22rem)] leading-none font-black tracking-[-0.09em] text-white/6 select-none sm:left-8 md:text-[clamp(15rem,24vw,24rem)]"
                data-testid="language-globe-watermark"
              >
                {watermark}
              </div>
            ) : null}

            <div
              className={cn(
                "relative z-10",
                isNotFound ? "max-w-3xl" : "max-w-5xl",
              )}
            >
              {eyebrow ? (
                <p className="text-xs font-bold tracking-[0.24em] text-brand-red uppercase sm:text-sm">
                  {eyebrow}
                </p>
              ) : null}

              <Heading
                className={cn(
                  "mt-4 leading-[0.98] font-extrabold tracking-[-0.045em] text-white text-balance",
                  isNotFound
                    ? "max-w-3xl text-4xl sm:mt-6 sm:text-6xl md:text-7xl"
                    : "max-w-5xl text-[clamp(2.75rem,6.5vw,5.5rem)]",
                )}
                id={headingId}
              >
                {title}
              </Heading>

              {description ? (
                <div className="mt-5 max-w-2xl text-base leading-7 font-medium text-stone-200/85 sm:text-lg sm:leading-8">
                  {description}
                </div>
              ) : null}

              {children ? (
                <div className="mt-4 max-w-2xl text-base leading-7 text-stone-300/80 sm:text-lg sm:leading-8">
                  {children}
                </div>
              ) : null}

              {actions.length > 0 ? (
                <nav
                  aria-label={actionsLabel}
                  className="mt-8 flex flex-col items-stretch gap-3 min-[420px]:flex-row min-[420px]:items-center sm:mt-10"
                >
                  {actions.map(
                    ({ href, icon, label, variant: actionVariant }) => (
                      <Link
                        className={cn(
                          actionBaseClasses,
                          actionVariant === "secondary"
                            ? "border border-white/35 bg-black/30 shadow-[0_14px_32px_rgba(0,0,0,0.22)] backdrop-blur hover:border-white/60 hover:bg-white/12"
                            : "bg-brand-red shadow-[0_14px_32px_rgba(0,0,0,0.34)] hover:bg-brand-red/90",
                        )}
                        href={href}
                        key={`${href}-${label}`}
                      >
                        {icon}
                        {label}
                      </Link>
                    ),
                  )}
                </nav>
              ) : null}
            </div>
          </div>

          <LanguageGlobe
            className={cn(
              "mt-2 sm:mt-0",
              isNotFound && "h-[clamp(29rem,58vw,44rem)]",
              globeClassName,
            )}
            layout="embedded"
          />
        </div>
      </div>
    </section>
  )
}
