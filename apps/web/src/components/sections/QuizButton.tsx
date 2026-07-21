"use client"

import { type ReactElement, useState } from "react"
import { Loader2, XIcon } from "lucide-react"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { useWatchModalActivity } from "@/components/watch/WatchModalActivityProvider"

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
  const [open, setOpen] = useState(false)
  useWatchModalActivity(open)

  return (
    <>
      <div className="mx-auto w-full px-6 pt-12 sm:w-auto lg:w-1/2 lg:px-8 xl:w-1/2 2xl:w-2xl">
        <button
          onClick={() => setOpen(true)}
          className="animate-mesh-gradient hover:animate-mesh-gradient-fast group relative w-full overflow-hidden rounded-lg bg-linear-to-tr from-yellow-500 via-amber-500 to-brand-red bg-size-[400%_400%] bg-blend-multiply text-white shadow-lg hover:bg-orange-500"
          aria-label="Open faith quiz"
          type="button"
        >
          <div className="flex cursor-pointer items-center justify-between p-4 xl:p-6">
            <div className="absolute inset-0 bg-[url(/watch/assets/overlay.svg)] bg-repeat opacity-50 mix-blend-multiply" />
            <div className="relative z-1 flex w-full items-center leading-[1.2] font-semibold md:text-xl xl:text-2xl">
              <span className="mr-4 flex-none rounded-lg border-2 border-white px-2 py-1 text-xs font-extrabold tracking-wider uppercase">
                Quiz
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
          showCloseButton={false}
          className="top-0 left-0 h-dvh w-dvw max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-transparent p-2 pt-14 ring-0 sm:max-w-none md:p-14 md:pt-0"
        >
          <DialogClose className="absolute top-4 right-4 z-10 rounded-full p-2 text-white transition-colors hover:bg-white/20 [&_svg]:size-8">
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogClose>
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
            title="Next Step of Faith Quiz"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
