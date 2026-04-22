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
            <span className="text-[34px] font-semibold tracking-[-0.04em] text-white [text-shadow:0_1px_0_rgba(0,0,0,0.55),0_2px_4px_rgba(0,0,0,0.45),0_6px_14px_rgba(0,0,0,0.4),0_14px_28px_rgba(0,0,0,0.32),0_28px_56px_rgba(0,0,0,0.24)] sm:text-[42px]">
              Studio
            </span>
            <span className="inline-flex h-6 items-center rounded-full border-2 border-white/45 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_1px_6px_rgba(0,0,0,0.18)]">
              Alpha
            </span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-start md:items-center">
          <div className="grid w-full items-center gap-8 max-md:pt-4 max-md:pb-8 md:grid-cols-2 md:gap-10 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:gap-20">
            <section
              className="w-full max-w-[480px] justify-self-center rounded-[1.5rem] border border-white/50 bg-white/84 px-6 py-6 text-black shadow-[0_24px_60px_rgba(8,8,8,0.14)] backdrop-blur-[12px] sm:px-8 sm:py-10 md:justify-self-start"
              aria-labelledby="studio-auth-title"
            >
              <div className="mb-6 sm:mb-8">
                <span className="block text-[11px] font-medium uppercase tracking-[0.16em] text-black/52">
                  Studio access
                </span>
                <h1
                  id="studio-auth-title"
                  className="text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] text-black"
                >
                  {title}
                </h1>
                <p className="mt-2.5 text-[14px] leading-[1.45] tracking-[-0.005em] text-black/54">
                  {subtitle}
                </p>
              </div>
              {children}
            </section>

            <aside
              className="flex items-center justify-center text-center text-white md:justify-start md:text-left"
              aria-label="Scripture quote"
            >
              <div className="w-full">
                <p
                  className={cn(
                    "relative text-balance text-[22px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[32px] sm:leading-[1.05] md:text-[42px] lg:text-[52px]",
                    "[text-shadow:0_1px_0_rgba(0,0,0,0.55),0_2px_4px_rgba(0,0,0,0.45),0_6px_14px_rgba(0,0,0,0.4),0_14px_28px_rgba(0,0,0,0.32),0_28px_56px_rgba(0,0,0,0.24)]",
                    "before:text-[0.9em] before:leading-none before:content-['“'] md:before:absolute md:before:top-0 md:before:left-[-0.55em]",
                  )}
                >
                  Each one heard them speaking in his own language…”
                </p>
                <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/72 [text-shadow:0_1px_0_rgba(0,0,0,0.4),0_2px_4px_rgba(0,0,0,0.35),0_8px_18px_rgba(0,0,0,0.28)] md:mt-4">
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
