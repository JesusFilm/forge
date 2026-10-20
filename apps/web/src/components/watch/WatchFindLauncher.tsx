"use client"

import { useEffect, useRef, useState, type ComponentType } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useWatchModalActivity } from "@/components/watch/WatchModalActivityProvider"
import type { WatchFindFlowProps } from "@/components/watch/WatchFindFlow"
import { cn } from "@/lib/utils"

export type WatchFindLauncherProps = WatchFindFlowProps & { className?: string }

/** The page/frame owns this small launcher; finder code and data start on open. */
export function WatchFindLauncher({
  languageSlug,
  locale,
  className,
}: WatchFindLauncherProps) {
  const [open, setOpen] = useState(false)
  const [Flow, setFlow] = useState<ComponentType<WatchFindFlowProps> | null>(
    null,
  )
  const [chunkFailed, setChunkFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // This layout-phase acquisition precedes the passive import below. The
  // existing shared hook also owns release through the visible close delay.
  useWatchModalActivity(open)

  useEffect(() => {
    if (!open || Flow) return
    let cancelled = false
    setChunkFailed(false)
    void import("@/components/watch/WatchFindFlow").then(
      (module) => {
        if (!cancelled) setFlow(() => module.WatchFindFlow)
      },
      () => {
        if (!cancelled) setChunkFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, Flow, attempt])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            ref={triggerRef}
            type="button"
            data-testid="watch-find-open"
            className={cn(
              "inline-flex cursor-pointer items-center justify-center rounded-full border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
              className,
            )}
          />
        }
      >
        Find films for you
      </DialogTrigger>
      <DialogContent
        finalFocus={triggerRef}
        data-testid="watch-find-flow"
        viewportClassName="fixed inset-0 z-[80] flex overflow-x-hidden overflow-y-auto p-3 sm:p-6"
        overlayClassName="z-[80] bg-black/70"
        className="m-auto w-full min-w-0 max-w-4xl shrink-0 border border-white/15 bg-stone-950 p-5 text-white sm:max-w-4xl sm:p-8"
        lang="en"
        dir="ltr"
      >
        <DialogTitle className="pr-8 text-2xl font-semibold">
          Find films for you
        </DialogTitle>
        <DialogDescription className="text-white/65">
          Films from our collections, with playable audio in the language you
          choose.
        </DialogDescription>
        {open ? (
          Flow ? (
            <Flow languageSlug={languageSlug} locale={locale} />
          ) : chunkFailed ? (
            <div role="alert">
              <p>The film finder could not load.</p>
              <Button
                variant="secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </Button>
            </div>
          ) : (
            <p role="status">Loading film finder…</p>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
