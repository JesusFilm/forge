"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import type { SendPromptSource } from "@/lib/chat-stub"
import type { UseConversations } from "@/lib/use-conversations"
import { requestApologist } from "./client"
import {
  ApologistError,
  type ApologistMessage,
  type FailureReason,
  type PromptMeta,
} from "./protocol"

export type ApologistTurn = ApologistMessage & {
  id: string
  meta?: PromptMeta
  error?: FailureReason
  status?: "generating" | "complete" | "stopped" | "failed"
}
type Pair = {
  controller: AbortController
  assistantId: string | null
  apologistDone: boolean
}

/** Own ephemeral Apologist history and reserve one pair before either dispatch. */
export function useComparison(
  forge: UseConversations,
  request = requestApologist,
) {
  const [turns, setTurns] = useState<ApologistTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [forgeStopped, setForgeStopped] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const history = useRef<ApologistTurn[]>([])
  const pair = useRef<Pair | null>(null)
  const alive = useRef(false)
  const owner = useRef(forge.activeId)
  const forgeRef = useRef(forge)
  forgeRef.current = forge
  const settle = useCallback(() => {
    const current = pair.current
    if (!current || !current.apologistDone) return
    const snapshot = forgeRef.current.getSnapshot()
    const message = snapshot.conversations
      .find((c) => c.id === owner.current)
      ?.messages.find((m) => m.id === current.assistantId)
    if (message && snapshot.pendingIds.has(owner.current)) return
    pair.current = null
    setBusy(false)
  }, [])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      pair.current?.controller.abort()
      pair.current = null
    }
  }, [])
  useEffect(settle, [
    forge.pendingIds,
    forge.activeConversation.messages,
    settle,
  ])

  const send = useCallback(
    (raw: string, source?: SendPromptSource) => {
      const text = raw.trim()
      if (!text || pair.current || !alive.current) return
      if (text.length > 4000) {
        setNotice(
          "Keep each comparison question to 4,000 characters or fewer. Your draft is unchanged.",
        )
        return
      }
      const snapshot = forgeRef.current.getSnapshot()
      if (
        snapshot.activeId !== owner.current ||
        snapshot.pendingIds.has(owner.current)
      )
        return
      const current: Pair = {
        controller: new AbortController(),
        assistantId: null,
        apologistDone: false,
      }
      pair.current = current
      setBusy(true)
      setForgeStopped(false)
      setNotice(null)
      const previous = snapshot.activeConversation.messages.at(-1)?.id
      forgeRef.current.send(text, source)
      const receipt = forgeRef.current
        .getSnapshot()
        .activeConversation.messages.at(-1)
      if (receipt?.role !== "assistant" || receipt.id === previous) {
        pair.current = null
        setBusy(false)
        return
      }
      current.assistantId = receipt.id
      const user: ApologistTurn = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      }
      const answer: ApologistTurn = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        status: "generating",
      }
      const messages = [
        ...history.current
          .filter((turn) => turn.content.length > 0)
          .map(({ role, content }) => ({ role, content })),
        { role: user.role, content: text },
      ]
      history.current = [...history.current, user, answer]
      setTurns(history.current)
      const update = (patch: Partial<ApologistTurn>) => {
        if (!alive.current || pair.current !== current) return
        history.current = history.current.map((turn) =>
          turn.id === answer.id ? { ...turn, ...patch } : turn,
        )
        setTurns(history.current)
      }
      void (async () => {
        let content = ""
        try {
          await request(
            messages,
            current.controller.signal,
            (meta) => update({ meta }),
            (token) => {
              content += token
              update({ content })
            },
          )
          update({ status: "complete" })
        } catch (error) {
          const reason = current.controller.signal.aborted
            ? "cancelled"
            : error instanceof ApologistError
              ? error.reason
              : "generation_failed"
          if (reason === "denied") setAccessDenied(true)
          update({
            error: reason,
            status: reason === "cancelled" ? "stopped" : "failed",
          })
        } finally {
          if (pair.current === current && alive.current) {
            current.apologistDone = true
            settle()
          }
        }
      })()
    },
    [request, settle],
  )
  const stop = () => {
    if (forgeRef.current.getSnapshot().pendingIds.has(owner.current))
      setForgeStopped(true)
    pair.current?.controller.abort()
    forgeRef.current.stopReply()
  }
  return { turns, busy, notice, send, stop, forgeStopped, accessDenied }
}
