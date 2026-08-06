"use client"

import type { ComponentType } from "react"
import {
  ArrowUpRight,
  BookOpen,
  Captions,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock,
  Headphones,
  Languages,
  Library,
  Play,
  Sparkles,
  Trophy,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { ENGLISH_ASSIST_COPY, englishAssistAttributes } from "./english-assist"

type GuideItem = {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
}

const GUIDE_GROUPS: Array<{ heading: string; items: GuideItem[] }> = [
  {
    heading: "Navigate",
    items: [
      { icon: Languages, label: ENGLISH_ASSIST_COPY.chooseLanguage },
      { icon: Sparkles, label: ENGLISH_ASSIST_COPY.sectionNew },
      { icon: BookOpen, label: ENGLISH_ASSIST_COPY.sectionVideoBible },
      { icon: BookOpen, label: ENGLISH_ASSIST_COPY.sectionBibleProject },
      { icon: Trophy, label: ENGLISH_ASSIST_COPY.sectionSports },
      { icon: Library, label: ENGLISH_ASSIST_COPY.sectionCollections },
      { icon: Captions, label: ENGLISH_ASSIST_COPY.sectionSubtitlesOnly },
      {
        icon: ChevronLeft,
        label: ENGLISH_ASSIST_COPY.previousSection,
      },
      { icon: ChevronRight, label: ENGLISH_ASSIST_COPY.nextSection },
    ],
  },
  {
    heading: "Open content",
    items: [
      { icon: Play, label: ENGLISH_ASSIST_COPY.openVideo },
      { icon: ArrowUpRight, label: ENGLISH_ASSIST_COPY.openCollection },
    ],
  },
  {
    heading: "Availability and order",
    items: [
      { icon: Sparkles, label: ENGLISH_ASSIST_COPY.stateNew },
      { icon: Headphones, label: ENGLISH_ASSIST_COPY.stateAudio },
      { icon: Captions, label: ENGLISH_ASSIST_COPY.stateSubtitles },
      { icon: Captions, label: ENGLISH_ASSIST_COPY.stateSubtitlesOnly },
      { icon: Clock, label: ENGLISH_ASSIST_COPY.stateNewestFirst },
    ],
  },
]

export function EnglishAssistGuide({ className }: { className?: string }) {
  return (
    <div lang="en" dir="ltr" className={cn("shrink-0", className)}>
      <Dialog>
        <DialogTrigger
          render={
            <Button
              type="button"
              variant="outline"
              aria-label={ENGLISH_ASSIST_COPY.openHelp}
              data-testid="english-assist-guide-trigger"
              className="min-h-9 rounded-full border-white/20 bg-stone-950/70 px-3 text-xs font-black tracking-[0.12em] text-white shadow-lg shadow-black/20 backdrop-blur hover:bg-white/10"
              {...englishAssistAttributes("openHelp")}
            />
          }
        >
          <CircleHelp className="size-4 text-amber-200" aria-hidden />
          EN
        </DialogTrigger>
        <DialogContent
          showCloseButton={false}
          data-testid="english-assist-guide-dialog"
          overlayClassName="bg-black/70 backdrop-blur-sm"
          viewportClassName="fixed inset-0 z-50 grid place-items-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top,0px))]"
          className="relative max-h-[min(90dvh,760px)] max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-stone-950 p-5 pr-14 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] text-stone-100 ring-1 ring-white/10 sm:p-6 sm:pr-16"
          lang="en"
          dir="ltr"
        >
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={ENGLISH_ASSIST_COPY.closeHelp}
                data-testid="english-assist-guide-close"
                className="absolute top-3 right-3 text-stone-200 hover:bg-white/10 hover:text-white"
                {...englishAssistAttributes("closeHelp")}
              />
            }
          >
            <X aria-hidden />
          </DialogClose>

          <DialogTitle className="text-xl leading-tight font-bold text-white sm:text-2xl">
            {ENGLISH_ASSIST_COPY.guideTitle}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-lg leading-6 text-stone-300">
            {ENGLISH_ASSIST_COPY.guideDescription}
          </DialogDescription>

          <div className="mt-6 space-y-6">
            {GUIDE_GROUPS.map((group) => (
              <section key={group.heading} aria-label={group.heading}>
                <h3 className="text-xs font-black tracking-[0.16em] text-amber-200 uppercase">
                  {group.heading}
                </h3>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {group.items.map(({ icon: Icon, label }) => (
                    <li
                      key={label}
                      className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-sm leading-5 text-stone-100"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-amber-200">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      {label}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
