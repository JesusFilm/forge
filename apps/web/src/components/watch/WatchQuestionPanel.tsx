"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  BookOpenText,
  Check,
  HandHeart,
  MessageSquareText,
  MessagesSquare,
  SendHorizontal,
  type LucideIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { useFloatingSearchPinned } from "@/components/FloatingSearchProvider"
import { WatchModalViewportCloseButton } from "@/components/watch/WatchModalViewportCloseButton"
import { useBetaTesterModal } from "@/components/watch/BetaTesterModalProvider"
import { useWatchModalActivity } from "@/components/watch/WatchModalActivityProvider"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"
import { GLASS_OUTLINE_CLASS } from "@/lib/glass-outline"

const PROMPT_ROTATION_MS = 3000
const FIELD_BASE_CLASS = `group flex min-h-14 min-w-0 cursor-text items-center gap-3 rounded-[35px] px-6 py-3 text-left shadow-xl ${GLASS_OUTLINE_CLASS} transition-[background-color,color] duration-300 ease-out`
const FIELD_GLASS_CLASS =
  "bg-white/10 text-white backdrop-blur-[10px] hover:bg-white hover:text-stone-950"
const FIELD_SOLID_CLASS = "bg-white text-stone-950"
const COMMENT_PROMPT_INDEX = 2

type PromptConfig = {
  id: "bibleQuestion" | "prayerRequest" | "comment" | "personChat"
  Icon: LucideIcon
}

const PROMPT_CONFIGS: PromptConfig[] = [
  { id: "bibleQuestion", Icon: BookOpenText },
  { id: "prayerRequest", Icon: HandHeart },
  { id: "comment", Icon: MessageSquareText },
  { id: "personChat", Icon: MessagesSquare },
]

type WatchQuestionPanelProps = {
  enabled: boolean
  modalSuppressed?: boolean
}

export function WatchQuestionPanel({
  enabled,
  modalSuppressed = false,
}: WatchQuestionPanelProps) {
  const t = useTranslations("WatchQuestionPanel")
  const betaModal = useBetaTesterModal()
  const betaModalOpen = betaModal?.open ?? false
  const setBetaQuestionPanelOpen = betaModal?.setQuestionPanelOpen
  const { pinned, searchOpen } = useFloatingSearchPinned()
  const inputRef = useRef<HTMLInputElement>(null)
  const [question, setQuestion] = useState("")
  const [promptIndex, setPromptIndex] = useState(0)
  const [selectedPromptIndex, setSelectedPromptIndex] =
    useState(COMMENT_PROMPT_INDEX)
  const [chatOpen, setChatOpen] = useState(false)
  const hasQuestion = question.trim().length > 0
  const currentPrompt = PROMPT_CONFIGS[promptIndex]!
  const selectedPrompt = PROMPT_CONFIGS[selectedPromptIndex]!
  const iconPrompt = chatOpen ? selectedPrompt : currentPrompt
  const PromptIcon = iconPrompt.Icon
  const visible =
    enabled && pinned && !searchOpen && !modalSuppressed && !betaModalOpen
  const modalOpen = visible && chatOpen
  useWatchModalActivity(modalOpen)

  useEffect(() => {
    setBetaQuestionPanelOpen?.(modalOpen)
    return () => setBetaQuestionPanelOpen?.(false)
  }, [modalOpen, setBetaQuestionPanelOpen])

  useEffect(() => {
    if (!visible || hasQuestion || chatOpen) return
    const timer = window.setInterval(() => {
      setPromptIndex((current) => (current + 1) % PROMPT_CONFIGS.length)
    }, PROMPT_ROTATION_MS)
    return () => window.clearInterval(timer)
  }, [chatOpen, hasQuestion, visible])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setQuestion("")
  }

  const openChatModal = () => {
    if (!visible) return
    setChatOpen(true)
  }

  const handlePromptSelect = (index: number) => {
    if (!modalOpen) return
    setSelectedPromptIndex(index)
    setPromptIndex(index)
    inputRef.current?.focus()
  }

  const closeChatModal = () => {
    setChatOpen(false)
    inputRef.current?.blur()
  }

  const promptLabel = (prompt: PromptConfig) => t(`prompts.${prompt.id}.label`)
  const promptDescription = (prompt: PromptConfig) =>
    t(`prompts.${prompt.id}.description`)

  return (
    <>
      <WatchModalViewportCloseButton
        open={modalOpen}
        onClose={closeChatModal}
        testId="watch-question-panel-close"
      />
      <div
        aria-hidden={modalOpen ? undefined : true}
        data-testid="watch-question-panel-modal"
        onClick={closeChatModal}
        className={`fixed inset-0 z-[55] transition-opacity duration-200 ease-out ${
          modalOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      >
        <div
          aria-hidden="true"
          data-testid="watch-question-panel-backdrop"
          className="absolute inset-0 bg-black/75 backdrop-blur-[12px]"
        />
        <div
          data-testid="watch-question-panel-modal-content"
          onClick={(event) => event.stopPropagation()}
          className={`relative z-10 flex min-h-dvh items-end pb-[calc(env(safe-area-inset-bottom,0px)+6.75rem)] text-white ${WATCH_PAGE_CONTENT_CLASSES}`}
        >
          <section
            aria-labelledby="watch-question-panel-intent-heading"
            className="w-full max-w-[640px] space-y-4"
          >
            <h2
              id="watch-question-panel-intent-heading"
              className="text-xs font-semibold tracking-[0.18em] text-white/55 uppercase"
            >
              {t("messageType")}
            </h2>
            <div className="relative">
              <div
                data-testid="watch-question-panel-options"
                className="divide-y divide-white/12 overflow-hidden rounded-lg border border-white/15 bg-white/[0.06]"
              >
                {PROMPT_CONFIGS.map((prompt, index) => {
                  const OptionIcon = prompt.Icon
                  const selected = selectedPromptIndex === index
                  const label = promptLabel(prompt)

                  return (
                    <button
                      key={prompt.id}
                      type="button"
                      aria-pressed={selected}
                      data-testid={`watch-question-panel-option-${index}`}
                      onClick={() => handlePromptSelect(index)}
                      className={`group flex min-h-16 w-full cursor-pointer items-center gap-4 px-3 py-3 text-left transition-[background-color,color,box-shadow] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none ${
                        selected
                          ? "bg-black/[0.18] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_12px_28px_rgba(0,0,0,0.34)]"
                          : "text-white/70 hover:text-white"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        data-testid={`watch-question-panel-option-icon-${index}`}
                        className={`grid h-8 w-8 shrink-0 place-items-center transition-colors duration-200 ${
                          selected ? "text-white" : "text-white/70"
                        }`}
                      >
                        <OptionIcon aria-hidden className="h-6 w-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base leading-[1.08] font-medium">
                          {label}
                        </span>
                        <span
                          className={`mt-0.5 block text-xs leading-[1.1] font-light ${
                            selected ? "text-white" : "text-white/42"
                          }`}
                        >
                          {promptDescription(prompt)}
                        </span>
                      </span>
                      <Check
                        aria-hidden
                        data-testid={`watch-question-panel-option-check-${index}`}
                        className={`h-5 w-5 shrink-0 transition-opacity duration-200 ${
                          selected
                            ? "text-white opacity-100"
                            : "text-white/40 opacity-0"
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
              <span
                aria-hidden="true"
                data-testid="watch-question-panel-tail"
                className="absolute bottom-[-0.38rem] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-r border-b border-white/15 bg-white/[0.06]"
              />
            </div>
          </section>
        </div>
      </div>
      <form
        aria-label={t("fieldLabel")}
        aria-hidden={visible ? undefined : true}
        inert={visible ? undefined : true}
        data-testid="watch-mobile-question-panel"
        onSubmit={handleSubmit}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeChatModal()
        }}
        className={`pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+0.875rem)] z-[57] transition-[opacity,transform] duration-200 ease-out ${
          visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        }`}
      >
        <div
          data-testid="watch-question-panel-rail"
          className={WATCH_PAGE_CONTENT_CLASSES}
        >
          <div
            data-testid="watch-question-panel-surface"
            className={`${FIELD_BASE_CLASS} ${
              chatOpen ? FIELD_SOLID_CLASS : FIELD_GLASS_CLASS
            } ${visible ? "pointer-events-auto" : "pointer-events-none"}`}
          >
            <span
              aria-hidden="true"
              data-testid="watch-mobile-question-panel-icon"
              data-current-prompt={promptLabel(iconPrompt)}
              className={`grid h-6 w-6 shrink-0 place-items-center transition-colors duration-300 ${
                chatOpen
                  ? "text-stone-950"
                  : "text-white/85 group-hover:text-stone-950"
              }`}
            >
              <PromptIcon
                key={iconPrompt.id}
                aria-hidden
                className="h-6 w-6 animate-watch-panel-swap"
              />
            </span>
            <div className="relative min-w-0 flex-1">
              <input
                ref={inputRef}
                type="text"
                name="watch-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onClick={openChatModal}
                onFocus={openChatModal}
                placeholder=""
                aria-label={promptLabel(iconPrompt)}
                autoComplete="off"
                enterKeyHint="send"
                data-testid="watch-mobile-question-panel-input"
                className={`relative z-10 h-8 w-full min-w-0 cursor-text bg-transparent text-base leading-none outline-none transition-colors duration-300 ${
                  chatOpen
                    ? "text-stone-950"
                    : "text-white group-hover:text-stone-950"
                }`}
              />
              {!hasQuestion && !chatOpen ? (
                <span
                  key={currentPrompt.id}
                  aria-hidden="true"
                  data-testid="watch-mobile-question-panel-prompt"
                  className="pointer-events-none absolute inset-y-0 left-0 z-0 flex max-w-full items-center truncate text-base leading-none text-white/90 transition-colors duration-300 animate-watch-panel-swap group-hover:text-stone-950"
                >
                  {promptLabel(currentPrompt)}
                </span>
              ) : null}
            </div>
            <button
              type="submit"
              aria-label={t("send")}
              data-testid="watch-mobile-question-panel-send"
              disabled={!hasQuestion}
              className={`-mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full transition focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none ${
                hasQuestion
                  ? "cursor-pointer bg-brand-red text-white hover:bg-brand-red/90"
                  : chatOpen
                    ? "cursor-not-allowed bg-stone-950/5 text-stone-400"
                    : "cursor-not-allowed bg-white/10 text-white/45 group-hover:bg-stone-950/5 group-hover:text-stone-400"
              }`}
            >
              <SendHorizontal aria-hidden className="h-5 w-5" />
            </button>
          </div>
        </div>
      </form>
    </>
  )
}
