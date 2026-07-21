"use client"

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"

import { useFloatingSearchPinned } from "@/components/FloatingSearchProvider"
import { useWatchModalActivity } from "@/components/watch/WatchModalActivityProvider"
import { BETA_TESTER_URL } from "@/lib/beta-tester"
import { cn } from "@/lib/utils"

type BetaTesterModalContextValue = {
  open: boolean
  openModal: (trigger?: HTMLElement | null) => void
  closeModal: () => void
  setQuestionPanelOpen: (open: boolean) => void
}

const BetaTesterModalContext =
  createContext<BetaTesterModalContextValue | null>(null)
const GLOBAL_BETA_TESTER_CTA_ENDPOINT = "/watch/api/beta-tester-cta"

const LazyBetaTesterModal = dynamic(
  () =>
    import("@/components/watch/BetaTesterModal").then((module) => ({
      default: module.BetaTesterModal,
    })),
  {
    ssr: false,
    loading: ({ error }) => (
      <BetaTesterModalLoadingFallback failed={error != null} />
    ),
  },
)

export function useBetaTesterModal() {
  return useContext(BetaTesterModalContext)
}

function BetaTesterModalLoadingShell({
  failed,
  onClose,
}: {
  failed: boolean
  onClose: () => void
}) {
  const t = useTranslations("BetaTesterModal")

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="beta-tester-loading-title"
      aria-describedby="beta-tester-loading-description"
      data-testid="beta-tester-modal-loading"
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 text-white backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-stone-950 p-6 text-center shadow-2xl">
        <h2 id="beta-tester-loading-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p
          id="beta-tester-loading-description"
          role="status"
          aria-live="polite"
          className="mt-3 text-sm text-stone-300"
        >
          {failed ? t("loadFailed") : t("loading")}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <a
            href={BETA_TESTER_URL}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-stone-950 hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 focus-visible:outline-none"
          >
            {t("openFormNewTab")}
          </a>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/20 px-5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  )
}

function BetaTesterModalLoadingFallback({ failed }: { failed: boolean }) {
  const modal = useBetaTesterModal()
  if (!modal?.open) return null
  return (
    <BetaTesterModalLoadingShell failed={failed} onClose={modal.closeModal} />
  )
}

class BetaTesterModalLoadBoundary extends Component<
  {
    children: ReactNode
    open: boolean
    onClose: () => void
  },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    if (!this.props.open) return null
    return <BetaTesterModalLoadingShell failed onClose={this.props.onClose} />
  }
}

export function BetaTesterTrigger({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  const t = useTranslations("BetaTesterModal")
  const modal = useBetaTesterModal()
  const label = children ?? t("trigger")

  if (!modal) {
    return (
      <a
        href={BETA_TESTER_URL}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={className}
      >
        {label}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => modal.openModal(event.currentTarget)}
      className={className}
    >
      {label}
    </button>
  )
}

export function BetaTesterModalProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <BetaTesterModalPathProvider key={pathname}>
      {children}
    </BetaTesterModalPathProvider>
  )
}

function BetaTesterModalPathProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("BetaTesterModal")
  const { playerChromeVisible, searchOpen } = useFloatingSearchPinned()
  const [open, setOpen] = useState(false)
  const [modalEnabled, setModalEnabled] = useState(false)
  const [questionPanelOpen, setQuestionPanelOpen] = useState(false)
  const [showGlobalTrigger, setShowGlobalTrigger] = useState(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useWatchModalActivity(open)

  useEffect(() => {
    let active = true

    void fetch(GLOBAL_BETA_TESTER_CTA_ENDPOINT, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) return null
        return (await response.json()) as { enabled?: unknown }
      })
      .then((result) => {
        if (active && typeof result?.enabled === "boolean") {
          setShowGlobalTrigger(result.enabled)
        }
      })
      .catch(() => {
        // Fail closed: the authored nested triggers remain available.
      })

    return () => {
      active = false
    }
  }, [])

  const openModal = useCallback(
    (trigger?: HTMLElement | null) => {
      if (searchOpen || questionPanelOpen) return
      returnFocusRef.current = trigger ?? null
      setModalEnabled(true)
      setOpen(true)
    },
    [questionPanelOpen, searchOpen],
  )

  const closeModal = useCallback(() => {
    setOpen(false)
    window.requestAnimationFrame(() => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const value = useMemo<BetaTesterModalContextValue>(
    () => ({
      open,
      openModal,
      closeModal,
      setQuestionPanelOpen,
    }),
    [closeModal, open, openModal],
  )

  const triggerUnavailable = searchOpen || questionPanelOpen || open
  const triggerVisible = playerChromeVisible && !searchOpen && !open

  return (
    <BetaTesterModalContext.Provider value={value}>
      <div inert={open || undefined} aria-hidden={open || undefined}>
        {children}
      </div>
      {showGlobalTrigger ? (
        <button
          type="button"
          data-testid="global-beta-tester-cta"
          disabled={triggerUnavailable || !triggerVisible}
          onClick={(event) => openModal(event.currentTarget)}
          className={cn(
            "fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+6.5rem)] z-[45] inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-stone-950 shadow-[0_12px_36px_rgba(0,0,0,0.4)] ring-1 ring-black/10 transition-[opacity,transform,background-color] duration-300 hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:outline-none disabled:pointer-events-none sm:right-6 sm:bottom-6",
            triggerVisible
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          {t("trigger")}
        </button>
      ) : null}
      {modalEnabled ? (
        <BetaTesterModalLoadBoundary open={open} onClose={closeModal}>
          <LazyBetaTesterModal
            open={open}
            onClose={closeModal}
            finalFocus={returnFocusRef}
          />
        </BetaTesterModalLoadBoundary>
      ) : null}
    </BetaTesterModalContext.Provider>
  )
}
