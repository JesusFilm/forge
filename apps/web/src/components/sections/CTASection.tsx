"use client"

import { useState } from "react"
import type { FragmentOf } from "@forge/graphql"
import { Loader2 } from "lucide-react"
import { ctaSectionFragment } from "@/lib/fragments/cta-section"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

export { ctaSectionFragment }

type CTASectionProps = {
  data: FragmentOf<typeof ctaSectionFragment>
}

function CTAModal({
  open,
  onClose,
  iframeSrc,
  title,
}: {
  open: boolean
  onClose: () => void
  iframeSrc: string
  title: string
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="absolute inset-0 -z-10 flex items-center justify-center">
          <div className="scale-200 text-white">
            <Loader2 className="animate-spin" />
          </div>
        </div>
        <iframe
          src={iframeSrc}
          className="z-10 h-full w-full border-0"
          title={title}
        />
      </DialogContent>
    </Dialog>
  )
}

export function CTASection({ data }: CTASectionProps) {
  const { buttonLabel, buttonLink, actionType, badge, modalIframeSrc } = data

  const [modalOpen, setModalOpen] = useState(false)
  const isModal = actionType === "modal" && modalIframeSrc

  const buttonContent = (
    <div className="flex cursor-pointer items-center justify-between p-4 xl:p-6">
      <div className="absolute inset-0 bg-[url(/assets/overlay.svg)] bg-repeat opacity-50 mix-blend-multiply" />
      <div className="relative z-10 flex w-full items-center leading-[1.2] font-semibold text-white md:text-xl xl:text-2xl">
        {badge && (
          <span className="mr-4 flex-none rounded-lg border-2 border-white px-2 py-1 text-xs font-extrabold tracking-wider uppercase">
            {badge}
          </span>
        )}
        <div className="flex-auto text-center">{buttonLabel}</div>
      </div>
      <span className="text-white transition">
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
  )

  if (isModal) {
    return (
      <div className="mx-auto w-full px-6 pt-12 sm:w-auto lg:w-1/2 lg:px-8 xl:w-1/2 2xl:w-2xl">
        <button
          onClick={() => setModalOpen(true)}
          className="animate-mesh-gradient group relative w-full overflow-hidden rounded-lg bg-linear-to-tr from-yellow-500 via-amber-500 to-red-700 bg-blend-multiply shadow-lg hover:animate-mesh-gradient-fast hover:bg-orange-500"
          aria-label={buttonLabel}
          tabIndex={0}
        >
          {buttonContent}
        </button>
        <CTAModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          iframeSrc={modalIframeSrc}
          title={buttonLabel}
        />
      </div>
    )
  }

  if (buttonLink) {
    return (
      <div className="mx-auto w-full px-6 pt-12 sm:w-auto lg:w-1/2 lg:px-8 xl:w-1/2 2xl:w-2xl">
        <a
          href={buttonLink}
          rel="noopener noreferrer"
          className="animate-mesh-gradient group relative block w-full overflow-hidden rounded-lg bg-linear-to-tr from-yellow-500 via-amber-500 to-red-700 bg-blend-multiply shadow-lg hover:animate-mesh-gradient-fast hover:bg-orange-500"
        >
          {buttonContent}
        </a>
      </div>
    )
  }

  return null
}
