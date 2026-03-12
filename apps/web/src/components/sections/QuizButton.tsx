"use client"

import { type ReactElement, useCallback, useState } from "react"

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
  const [modalOpen, setModalOpen] = useState(false)

  const handleOpen = useCallback(() => setModalOpen(true), [])
  const handleClose = useCallback(() => setModalOpen(false), [])

  return (
    <>
      <div className="mx-auto w-full px-6 pt-12 sm:w-auto lg:w-1/2 lg:px-8 xl:w-1/2 2xl:w-2xl">
        <button
          onClick={handleOpen}
          className="animate-mesh-gradient hover:animate-mesh-gradient-fast group relative w-full overflow-hidden rounded-lg bg-linear-to-tr from-yellow-500 via-amber-500 to-red-700 bg-size-[400%_400%] bg-blend-multiply text-white shadow-lg hover:bg-orange-500"
          aria-label="Open faith quiz"
          type="button"
        >
          <div className="flex cursor-pointer items-center justify-between p-4 xl:p-6">
            <div className="absolute inset-0 bg-[url(/assets/overlay.svg)] bg-repeat opacity-50 mix-blend-multiply" />
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

      {modalOpen && <QuizModal iframeSrc={iframeSrc} onClose={handleClose} />}
    </>
  )
}

function QuizModal({
  iframeSrc,
  onClose,
}: {
  iframeSrc: string
  onClose: () => void
}): ReactElement {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Quiz"
    >
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onClose()
        }}
        role="button"
        tabIndex={0}
        aria-label="Close quiz"
      />
      <div className="relative h-full w-full p-2 pt-14 sm:p-6 md:p-14">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-full p-2 text-white transition-colors hover:bg-white/20"
          aria-label="Close quiz"
          type="button"
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <iframe
          src={iframeSrc}
          className="h-full w-full rounded-lg border-0"
          title="Next Step of Faith Quiz"
        />
      </div>
    </div>
  )
}
