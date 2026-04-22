import Image from "next/image"
import { unstable_noStore as noStore } from "next/cache"
import type { ReactNode } from "react"
import { StudioAuthBackground } from "@/features/shell/studio-auth-background"
import { getRandomStudioAuthBackgroundImage } from "@/features/shell/studio-auth-background-data"
import { cn } from "@/lib/utils"

export function StudioAuthShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode
  title: string
  subtitle: string
}) {
  noStore()

  const backgroundImage = getRandomStudioAuthBackgroundImage()

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <StudioAuthBackground image={backgroundImage} />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-6 py-8 sm:px-8 md:px-10 md:py-10 lg:px-14 lg:py-12">
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="flex items-center gap-4">
            <Image
              alt=""
              aria-hidden="true"
              className="h-[24px] w-[34px] shrink-0 sm:h-[28px] sm:w-[39px]"
              height={28}
              src="/jesusfilm-sign.svg"
              width={39}
            />
            <span className="text-[34px] font-semibold tracking-[-0.04em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.24)] sm:text-[42px]">
              Studio
            </span>
            <span className="inline-flex h-6 items-center rounded-full border border-white/45 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_1px_6px_rgba(0,0,0,0.18)]">
              Alpha
            </span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center">
          <div className="grid w-full items-center gap-10 max-lg:py-8 lg:grid-cols-[minmax(0,860px)_minmax(0,1fr)] lg:gap-16">
            <section
              className="rounded-[2rem] border border-white/50 bg-white/84 px-6 py-8 text-black shadow-[0_24px_60px_rgba(8,8,8,0.14)] backdrop-blur-[12px] sm:px-10 sm:py-11"
              aria-labelledby="studio-auth-title"
            >
              <div className="mb-8 sm:mb-10">
                <span className="block text-[12px] font-medium uppercase tracking-[0.16em] text-black/52">
                  Studio access
                </span>
                <h1
                  id="studio-auth-title"
                  className="text-[32px] font-semibold leading-[1.05] tracking-[-0.03em] text-black sm:text-[40px]"
                >
                  {title}
                </h1>
                <p className="mt-4 text-[16px] leading-[1.35] tracking-[-0.01em] text-black/54">
                  {subtitle}
                </p>
              </div>
              {children}
            </section>

            <aside
              className="flex items-center justify-center text-center text-white lg:justify-start lg:text-left"
              aria-label="Scripture quote"
            >
              <div className="w-full max-w-none lg:max-w-[17ch]">
                <p
                  className={cn(
                    "relative mx-auto max-w-full text-balance text-[28px] font-semibold leading-[1] tracking-[-0.03em] text-white drop-shadow-[0_10px_24px_rgba(0,0,0,0.28)] sm:text-[36px] lg:mx-0 lg:text-[48px]",
                    "before:text-[0.9em] before:leading-none before:content-['“'] before:drop-shadow-[0_10px_24px_rgba(0,0,0,0.28)] lg:before:absolute lg:before:top-0 lg:before:left-[-0.34em]",
                  )}
                >
                  Each one heard them speaking in his own language…”
                </p>
                <p className="mt-3 text-[13px] font-semibold tracking-[-0.01em] text-white/76 drop-shadow-[0_8px_16px_rgba(0,0,0,0.22)] sm:text-[15px] lg:mt-4">
                  Acts 2:6–8
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  )
}
