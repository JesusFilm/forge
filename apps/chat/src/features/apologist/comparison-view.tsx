"use client"
import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import { AssistantMarkdown } from "@/components/chat/assistant-markdown"
import { Composer } from "@/components/chat/composer"
import { MessageList } from "@/components/chat/message-list"
import type { UseConversations } from "@/lib/use-conversations"
import type { FailureReason } from "./protocol"
import { useComparison } from "./use-comparison"

function failureNotice(reason: FailureReason) {
  if (reason === "history_limit")
    return "Apologist's conversation limit was reached. Start a New conversation to compare again."
  if (reason === "input_limit")
    return "Apologist's text limit was reached. Start a New conversation to compare again."
  if (reason === "cancelled") return "Apologist's response was stopped."
  if (reason === "denied") return "Your access to Apologist has changed."
  if (reason === "unavailable")
    return "Apologist is unavailable. Forge remains available."
  if (reason === "timeout") return "Apologist timed out before finishing."
  return "Apologist couldn't finish this answer. You can send another shared question."
}

/** Two independent transcripts, mobile tabs and one composer over the existing Forge session. */
export default function ComparisonView({
  forge,
  onExit,
  composerRef,
}: {
  forge: UseConversations
  onExit: (reason?: "denied") => void
  composerRef: RefObject<HTMLTextAreaElement | null>
}) {
  const comparison = useComparison(forge)
  useEffect(() => {
    if (comparison.accessDenied) onExit("denied")
  }, [comparison.accessDenied, onExit])
  const [tab, setTab] = useState<"Forge" | "Apologist">("Forge")
  const [desktop, setDesktop] = useState(false)
  const forgePane = useRef<HTMLDivElement>(null)
  const apologistPane = useRef<HTMLDivElement>(null)
  const pinned = useRef({ Forge: true, Apologist: true })
  const forgeLast = forge.activeConversation.messages.at(-1)
  const forgeStatus = forge.pending
    ? "generating"
    : comparison.forgeStopped
      ? "stopped"
      : forgeLast?.role === "assistant"
        ? forgeLast.error === "cancelled"
          ? "stopped"
          : forgeLast.error
            ? "failed"
            : "complete"
        : ""
  const apologistStatus = comparison.turns.at(-1)?.status ?? ""
  const showForge = desktop || tab === "Forge"
  const showApologist = desktop || tab === "Apologist"
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)")
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  useEffect(() => {
    composerRef.current?.focus()
  }, [composerRef])
  useEffect(() => {
    if (!showForge)
      forgePane.current
        ?.querySelectorAll("video, mux-video")
        .forEach((element) => {
          if ("pause" in element && typeof element.pause === "function")
            element.pause()
        })
  }, [showForge, forge.activeConversation.messages])
  useEffect(() => {
    if (forgePane.current && pinned.current.Forge)
      forgePane.current.scrollTop = forgePane.current.scrollHeight
    if (apologistPane.current && pinned.current.Apologist)
      apologistPane.current.scrollTop = apologistPane.current.scrollHeight
  }, [forge.activeConversation.messages, comparison.turns])
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-comparison>
      <div className="flex items-center justify-between border-b border-linen/10 px-6 py-3">
        <h1 className="font-display text-xl">Compare answers</h1>
        <button
          className="rounded-full border border-linen/15 px-4 py-2 text-sm"
          onClick={() => onExit()}
        >
          Return to Forge
        </button>
      </div>
      <div
        className="flex border-b border-linen/10 lg:hidden"
        role="tablist"
        aria-label="Answer provider"
      >
        {(["Forge", "Apologist"] as const).map((provider, index) => (
          <button
            key={provider}
            id={`tab-${provider}`}
            role="tab"
            aria-selected={tab === provider}
            aria-controls={`pane-${provider}`}
            tabIndex={tab === provider ? 0 : -1}
            className="flex-1 px-4 py-3 aria-selected:border-b-2 aria-selected:border-vesper"
            onClick={() => setTab(provider)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return
              event.preventDefault()
              const target =
                event.key === "Home"
                  ? "Forge"
                  : event.key === "End"
                    ? "Apologist"
                    : index === 0
                      ? "Apologist"
                      : "Forge"
              setTab(target)
              document.getElementById(`tab-${target}`)?.focus()
            }}
          >
            {provider}
            {(provider === "Forge" ? forgeStatus : apologistStatus) &&
              ` · ${provider === "Forge" ? forgeStatus : apologistStatus}`}
          </button>
        ))}
      </div>
      <div role="status" className="sr-only">
        {forgeStatus && `Forge ${forgeStatus}. `}
        {apologistStatus && `Apologist ${apologistStatus}.`}
      </div>
      <div className="flex min-h-0 flex-1">
        <section
          id="pane-Forge"
          role={desktop ? "region" : "tabpanel"}
          aria-label="Forge"
          hidden={!showForge}
          className="min-w-0 flex-1 border-r border-linen/10"
        >
          <div className="flex h-full min-h-0 flex-col">
            <h2 className="hidden shrink-0 border-b border-linen/10 px-6 py-4 font-display text-xl lg:block">
              Forge{forgeStatus && ` · ${forgeStatus}`}
            </h2>
            <div
              ref={forgePane}
              onScroll={(event) => {
                const pane = event.currentTarget
                pinned.current.Forge =
                  pane.scrollHeight - pane.scrollTop - pane.clientHeight < 64
              }}
              className="min-h-0 flex-1 overflow-y-auto p-6"
              tabIndex={-1}
            >
              <MessageList
                providerLabel="Forge"
                messages={forge.activeConversation.messages}
                streamingMessageId={showForge ? forge.streamingMessageId : null}
                followUpsDisabled={comparison.busy}
                onSelectFollowUp={(question) => {
                  comparison.send(question, "follow_up")
                  forgePane.current?.focus()
                }}
              />
            </div>
          </div>
        </section>
        <section
          id="pane-Apologist"
          role={desktop ? "region" : "tabpanel"}
          aria-label="Apologist"
          hidden={!showApologist}
          className="min-w-0 flex-1"
        >
          <div className="flex h-full min-h-0 flex-col">
            <h2 className="hidden shrink-0 border-b border-linen/10 px-6 py-4 font-display text-xl lg:block">
              Apologist{apologistStatus && ` · ${apologistStatus}`}
            </h2>
            <div
              ref={apologistPane}
              onScroll={(event) => {
                const pane = event.currentTarget
                pinned.current.Apologist =
                  pane.scrollHeight - pane.scrollTop - pane.clientHeight < 64
              }}
              className="min-h-0 flex-1 overflow-y-auto p-6"
            >
              <ol className="flex flex-col gap-8">
                {comparison.turns.map((turn) => (
                  <li
                    key={turn.id}
                    aria-label={
                      turn.role === "assistant"
                        ? "Apologist response"
                        : undefined
                    }
                    className="text-lg leading-relaxed"
                    aria-live={
                      showApologist && turn.status === "generating"
                        ? "polite"
                        : "off"
                    }
                  >
                    {turn.role === "user" ? (
                      <p className="ml-auto max-w-[460px] rounded-xl bg-embersoot px-4 py-3 whitespace-pre-wrap">
                        {turn.content}
                      </p>
                    ) : (
                      <>
                        {turn.meta?.source === "fallback" && (
                          <p className="mb-2 text-sm text-vesper">
                            Apologist is using the fallback prompt for this
                            answer.
                          </p>
                        )}
                        <AssistantMarkdown
                          content={turn.content}
                          streaming={turn.status === "generating"}
                        />
                        {turn.error && (
                          <p
                            role={showApologist ? "alert" : undefined}
                            className="mt-2 text-sm text-vesper"
                          >
                            {failureNotice(turn.error)}
                          </p>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      </div>
      <div className="mx-auto w-full max-w-[900px] shrink-0 px-6 pt-3 pb-6">
        {comparison.notice && (
          <p role="alert" className="mb-2 text-sm text-vesper">
            {comparison.notice}
          </p>
        )}
        <Composer
          draft={forge.draft}
          pending={comparison.busy}
          seekerEnabled
          placeholder="Ask Forge and Apologist the same question."
          textareaRef={composerRef}
          onChange={forge.setDraft}
          onSend={comparison.send}
          onStop={comparison.stop}
        />
        <p className="mt-2 text-center text-xs text-ash">
          Apologist answers are temporary. Forge keeps its conversation history.
        </p>
      </div>
    </div>
  )
}
