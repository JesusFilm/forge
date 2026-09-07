"use client"
import { useEffect, useRef, useState } from "react"
import { attachPreparedSources, previewSignature } from "./preview-state"
import type { StudioDocument } from "@forge/studio-contracts"
import type { EditorSession, EditorSnapshot } from "./editor-session"
function releasePreview(url: string) {
  void fetch("/api/studio/preview", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
    keepalive: true,
  }).catch(() => {})
}
class StudioPreviewError extends Error {}

export default function Preview({
  session,
  state,
  projectId,
  playing,
  onPlaying,
}: {
  session: EditorSession
  state: EditorSnapshot
  projectId: string
  playing: boolean
  onPlaying: (v: boolean) => void
}) {
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [ready, setReady] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null),
    latest = useRef(state),
    lastSent = useRef(-1),
    lastFrame = useRef(-1),
    heartbeat = useRef(0),
    lastDocument = useRef<StudioDocument | null>(null)
  useEffect(() => {
    latest.current = state
  }, [state])
  const signature = previewSignature(state.document)
  const preparedSignature = useRef<string | null>(null)
  useEffect(() => {
    if (preparedSignature.current === signature) return
    const requested = latest.current.document
    const requestedSignature = previewSignature(requested)
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      setUrl(null)
      setError("")
      setReady(false)
    })
    const request = async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        controller.signal.throwIfAborted()
        const response = await fetch("/api/studio/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, document: requested }),
          signal: controller.signal,
        })
        if (response.status !== 503 || attempt === 7) return response
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new StudioPreviewError("Preview remains busy; retry shortly")
    }
    request()
      .then(async (r) => {
        const value = (await r.json()) as {
          url: string
          document: StudioDocument
          error?: string
        }
        if (!r.ok)
          throw new StudioPreviewError(value.error ?? "Preview unavailable")
        if (
          controller.signal.aborted ||
          previewSignature(latest.current.document) !== requestedSignature
        ) {
          releasePreview(value.url)
          return
        }
        const next = attachPreparedSources(
          latest.current.document,
          requested,
          value.document,
        )
        preparedSignature.current = previewSignature(next)
        session.edit(() => next)
        setUrl(value.url)
        heartbeat.current = performance.now()
        lastDocument.current = null
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [projectId, signature, attempt, session])
  useEffect(() => {
    if (!url) return
    const release = () => releasePreview(url)
    let active = true
    const renew = async () => {
      try {
        const response = await fetch("/api/studio/preview", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) throw new StudioPreviewError("Preview renewal failed")
      } catch {
        if (active) {
          preparedSignature.current = null
          setAttempt((n) => n + 1)
        }
      }
    }
    const timer = window.setInterval(() => void renew(), 5 * 60000)
    const onVisible = () => {
      if (document.visibilityState === "visible") void renew()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("pagehide", release)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("pagehide", release)
      release()
    }
  }, [url])
  useEffect(() => {
    if (!url) return
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null"
      )
        return
      const data = event.data
      if (!data || typeof data !== "object") return
      if (data.type === "heartbeat") heartbeat.current = performance.now()
      if (data.type === "ready") {
        setReady(true)
        heartbeat.current = performance.now()
        frame.current?.contentWindow?.postMessage(
          { type: "seek", frame: latest.current.playhead },
          "*",
        )
      }
      if (
        data.type === "frame" &&
        Number.isInteger(data.frame) &&
        data.frame >= 0 &&
        data.frame < latest.current.document.durationInFrames
      ) {
        lastFrame.current = data.frame
        session.seek(data.frame)
      }
      if (data.type === "error") {
        setError(
          typeof data.message === "string"
            ? data.message.slice(0, 1000)
            : "Preview failed",
        )
        setUrl(null)
        onPlaying(false)
      }
    }
    window.addEventListener("message", receive)
    const timer = setInterval(() => {
      if (performance.now() - heartbeat.current > 2500) {
        setError("Preview stopped responding. Your edits are safe.")
        setUrl(null)
        onPlaying(false)
      }
    }, 250)
    return () => {
      clearInterval(timer)
      window.removeEventListener("message", receive)
    }
  }, [url, session, onPlaying])
  useEffect(() => {
    if (!ready) return
    if (lastDocument.current !== state.document) {
      frame.current?.contentWindow?.postMessage(
        { type: "document", document: state.document },
        "*",
      )
      lastDocument.current = state.document
    }
  }, [state.document, ready])
  useEffect(() => {
    if (!ready) return
    if (
      state.playhead !== lastFrame.current &&
      state.playhead !== lastSent.current
    ) {
      frame.current?.contentWindow?.postMessage(
        { type: "seek", frame: state.playhead },
        "*",
      )
      lastSent.current = state.playhead
    }
  }, [state.playhead, ready])
  useEffect(() => {
    if (ready)
      frame.current?.contentWindow?.postMessage(
        { type: playing ? "play" : "pause" },
        "*",
      )
  }, [playing, ready])
  return (
    <div className="nle-preview" data-preview-ready={ready}>
      {error ? (
        <div className="nle-preview-message" role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              preparedSignature.current = null
              setAttempt((n) => n + 1)
            }}
          >
            Retry preview
          </button>
        </div>
      ) : url ? (
        <iframe
          ref={frame}
          title="Live composition preview"
          src={url}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="autoplay"
        />
      ) : (
        <div className="nle-preview-message">Preparing live preview…</div>
      )}
    </div>
  )
}
