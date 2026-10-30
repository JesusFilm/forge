"use client"

// Opens the "find my films" flow. Presentation is the original prototype's
// (`WatchFindButton` + a portal host). Runtime adapters kept from the current
// app: open state lives in memory, not `?find=1`, so cached Watch URLs never
// change; the flow's code loads on first open; the shared modal activity
// pauses the player; the page behind is inert; focus returns to the button
// that opened it. Loading and load-failure show the flow's own shell and
// header, so Close is always visible.

import { Sparkles, X } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react"
import { createPortal } from "react-dom"

import { buttonVariants } from "@/components/ui/button-variants"
import { useWatchModalActivity } from "@/components/watch/WatchModalActivityProvider"
import type { WatchFindFlowProps } from "@/components/watch/WatchFindFlow"
import { cn } from "@/lib/utils"

/* One open flag per page, shared by every button and the host. */
let open = false
let opener: HTMLElement | null = null
const listeners = new Set<() => void>()

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function setOpen(next: boolean, from?: HTMLElement | null) {
  if (next) opener = from ?? null
  open = next
  listeners.forEach((listener) => listener())
}

export type WatchFindHostProps = Omit<WatchFindFlowProps, "onClose">

/**
 * The flow itself, mounted once per page. It goes through a portal to <body>:
 * the watch page has transformed/clipping ancestors, and `position: fixed`
 * inside one of those is positioned against that ancestor, not the viewport —
 * which is why an overlay rendered in place appears under the hero instead of
 * over it.
 */
export function WatchFindFlowHost({
  languageSlug,
  locale,
}: WatchFindHostProps) {
  const isOpen = useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
  const [Flow, setFlow] = useState<ComponentType<WatchFindFlowProps> | null>(
    null,
  )
  const [chunkFailed, setChunkFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useWatchModalActivity(isOpen)

  const close = useCallback(() => setOpen(false), [])

  // Closed on unmount (route change), so a later page does not open it.
  useEffect(() => () => setOpen(false), [])

  useEffect(() => {
    if (!isOpen || Flow) return
    let cancelled = false
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
  }, [isOpen, Flow, attempt])

  // Everything behind the overlay is inert, whichever face (loading, failed,
  // loaded) is showing. Declared before the effect below so the page is
  // interactive again before focus returns to it.
  useLayoutEffect(() => {
    if (!isOpen) return
    const made: Element[] = []
    for (const child of document.body.children) {
      if (child.matches(OVERLAY_SELECTOR) || child.hasAttribute("inert"))
        continue
      child.setAttribute("inert", "")
      made.push(child)
    }
    return () => made.forEach((child) => child.removeAttribute("inert"))
  }, [isOpen, Flow])

  // Hold the page still behind the flow; on close, focus goes back to the
  // control that opened it.
  useLayoutEffect(() => {
    if (!isOpen) return
    const target = opener
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
      opener = null
      if (target?.isConnected) target.focus()
    }
  }, [isOpen])

  if (!isOpen) return null
  return createPortal(
    Flow ? (
      <Flow languageSlug={languageSlug} locale={locale} onClose={close} />
    ) : (
      <PendingShell
        failed={chunkFailed}
        onRetry={() => {
          setChunkFailed(false)
          setAttempt((n) => n + 1)
        }}
        onClose={close}
      />
    ),
    document.body,
  )
}

const OVERLAY_SELECTOR = '[data-testid="watch-find-flow"]'

const PHASES = ["What you're after", "How you watch", "Films for you"]

/**
 * The flow's own full-screen shell and header (first phase current, with its
 * Close control) while the flow's code loads or after it failed to load.
 */
function PendingShell({
  failed,
  onRetry,
  onClose,
}: {
  failed: boolean
  onRetry: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  // Escape closes; Tab stays inside the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
        return
      }
      if (e.key !== "Tab" || !ref.current) return
      const focusable = [
        ...ref.current.querySelectorAll<HTMLElement>("button:not([disabled])"),
      ]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const inside = ref.current.contains(document.activeElement)
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid="watch-find-flow"
      className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-stone-950 text-white outline-none"
      role="dialog"
      lang="en"
      dir="ltr"
      aria-modal="true"
      aria-label="Find films for you"
      aria-busy={!failed}
    >
      <header className="sticky top-0 z-10 flex min-w-0 items-center gap-4 border-b border-white/10 bg-stone-950/95 px-5 py-3 backdrop-blur-sm md:px-8">
        <p className="shrink-0 text-[13px] font-bold tracking-[0.16em] text-white/80 uppercase">
          Jesus Film
        </p>
        <div className="flex min-w-0 flex-1 justify-center gap-3 md:gap-6">
          {PHASES.map((label, i) => (
            <div key={label} className="min-w-0 max-w-[10rem] flex-1">
              <span
                className={cn(
                  "block h-1 rounded-full transition-colors duration-300",
                  i === 0 ? "bg-brand-red" : "bg-white/15",
                )}
              />
              <span
                className={cn(
                  "mt-1.5 block truncate text-center text-[11px] md:text-[12px]",
                  i === 0 ? "font-semibold text-white" : "text-white/40",
                )}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-white/15 text-white/70 transition-colors hover:border-white hover:text-white"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div className="mx-auto w-full max-w-3xl px-5 pt-10 pb-24 md:px-8 md:pt-16">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
          {failed ? (
            <div role="alert" className="min-w-0">
              <p className="text-[14px] text-white/55">
                The film finder could not load.
              </p>
              <button
                type="button"
                onClick={onRetry}
                className={cn(buttonVariants({ variant: "pill" }), "mt-4 h-12")}
              >
                Try again
              </button>
            </div>
          ) : (
            <span
              role="status"
              aria-label="Loading"
              className="block h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-brand-red"
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** The button that starts it. */
export function WatchFindButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      data-testid="watch-find-open"
      onClick={(event) => setOpen(true, event.currentTarget)}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 text-[14px] font-semibold transition-colors hover:border-white hover:bg-white hover:text-stone-900 focus-visible:border-white focus-visible:bg-white focus-visible:text-stone-900 focus-visible:outline-none",
        className,
      )}
    >
      <Sparkles aria-hidden className="size-4" />
      Find films for you
    </button>
  )
}

export type WatchFindLauncherProps = WatchFindHostProps & { className?: string }

/**
 * Compatibility: button and host together, for a caller that has no
 * page-level host. Do not combine with a separately mounted host.
 */
export function WatchFindLauncher({
  languageSlug,
  locale,
  className,
}: WatchFindLauncherProps) {
  return (
    <>
      <WatchFindButton className={className} />
      <WatchFindFlowHost languageSlug={languageSlug} locale={locale} />
    </>
  )
}
