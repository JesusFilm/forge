"use client"

import { type ReactElement, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useWatchModalActivity } from "@/components/watch/WatchModalActivityProvider"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"

type QuizButtonData = {
  id: string
  buttonText: string
  iframeSrc: string
}

type QuizButtonProps = {
  data: QuizButtonData
}

export function QuizButton({ data }: QuizButtonProps): ReactElement {
  const { buttonText, iframeSrc } = data
  const modalT = useTranslations("WatchModal")
  const studyT = useTranslations("WatchStudyQuestions")
  const [open, setOpen] = useState(false)
  useWatchModalActivity(open)

  return (
    <>
      <div className="mx-auto w-full px-6 pt-12 sm:w-auto lg:w-1/2 lg:px-8 xl:w-1/2 2xl:w-2xl">
        <button
          onClick={() => setOpen(true)}
          className="animate-mesh-gradient hover:animate-mesh-gradient-fast group relative w-full overflow-hidden rounded-lg bg-linear-to-tr from-yellow-500 via-amber-500 to-brand-red bg-size-[400%_400%] bg-blend-multiply text-white shadow-lg hover:bg-orange-500"
          aria-label={buttonText}
          type="button"
        >
          <div className="flex cursor-pointer items-center justify-between p-4 xl:p-6">
            <div className="absolute inset-0 bg-[url(/watch/assets/overlay.svg)] bg-repeat opacity-50 mix-blend-multiply" />
            <div className="relative z-1 flex w-full items-center leading-[1.2] font-semibold md:text-xl xl:text-2xl">
              <span className="mr-4 flex-none rounded-lg border-2 border-white px-2 py-1 text-xs font-extrabold tracking-wider uppercase">
                {studyT("quiz")}
              </span>
              <div className="flex-auto text-center">{buttonText}</div>
            </div>
            <span className="transition">
              <svg fill="none" height="24" width="24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 5l7 7m0 0l-7 7m7-7H6"
                />
              </svg>
            </span>
          </div>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          overlayClassName="bg-black/80 backdrop-blur-sm"
          viewportClassName="fixed inset-0 z-50 grid place-items-center overflow-hidden"
          showCloseButton={false}
          className="h-dvh w-dvw max-w-none gap-0 rounded-none border-0 bg-transparent p-2 pt-14 ring-0 sm:max-w-none md:p-14 md:pt-0"
        >
          <WatchModalViewportCloseButton
            open={open}
            onClose={() => setOpen(false)}
            testId="watch-quiz-modal-close"
            ariaLabel={modalT("close")}
          />
          <div className="absolute inset-0 -z-1 flex items-center justify-center">
            <div className="scale-200 text-white">
              <Loader2 className="animate-spin" />
            </div>
          </div>
          <iframe
            src={iframeSrc}
            sandbox="allow-forms allow-scripts allow-same-origin"
            referrerPolicy="strict-origin-when-cross-origin"
            className="z-1 h-full w-full border-0"
            title={buttonText}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
