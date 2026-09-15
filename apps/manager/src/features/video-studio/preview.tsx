"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Player, type PlayerRef } from "@remotion/player"
import { StudioComposition } from "@forge/shorts-compositions/studio/Composition"
import {
  studioPreviewSchema,
  type StudioPreview,
} from "@forge/studio-contracts/preview"
import { previewSignature } from "./preview-state"
import type { EditorSession, EditorSnapshot } from "./editor-session"

class StudioPreviewError extends Error {}
type BrowserPreview = {
  input: StudioPreview
  urls: Record<string, string>
  files: { name: string; type: string; base64: string }[]
}
type Prepared = {
  input: StudioPreview
  mediaUrls: Record<string, string>
  signature: string
}
type Props = {
  session: Pick<EditorSession, "edit" | "seek">
  state: EditorSnapshot
  projectId: string
  playing: boolean
  onPlaying: (value: boolean) => void
}
function PlaybackError({
  error,
  onError,
}: {
  error: Error
  onError: (message: string) => void
}) {
  useEffect(() => onError(error.message), [error, onError])
  return <p>Preview failed</p>
}
function LivePlayer({
  prepared,
  state,
  session,
  playing,
  onPlaying,
  onError,
}: Props & { prepared: Prepared; onError: (message: string) => void }) {
  const player = useRef<PlayerRef>(null)
  const input = useMemo(
    () => ({ ...prepared.input, document: state.document }),
    [prepared.input, state.document],
  )
  const inputProps = useMemo(
    () => ({ input, mediaUrls: prepared.mediaUrls, onError }),
    [input, prepared.mediaUrls, onError],
  )
  useEffect(() => {
    const current = player.current
    if (!current) return
    const frame = () => session.seek(current.getCurrentFrame())
    const pause = () => onPlaying(false)
    current.addEventListener("frameupdate", frame)
    current.addEventListener("pause", pause)
    current.addEventListener("ended", pause)
    return () => {
      current.removeEventListener("frameupdate", frame)
      current.removeEventListener("pause", pause)
      current.removeEventListener("ended", pause)
    }
  }, [session, onPlaying])
  useEffect(() => {
    const current = player.current
    if (current && current.getCurrentFrame() !== state.playhead)
      current.seekTo(state.playhead)
  }, [state.playhead])
  useEffect(() => {
    if (playing) player.current?.play()
    else player.current?.pause()
  }, [playing])
  return (
    <Player
      ref={player}
      component={StudioComposition}
      inputProps={inputProps}
      compositionWidth={input.document.width}
      compositionHeight={input.document.height}
      durationInFrames={input.document.durationInFrames}
      fps={input.document.fps}
      acknowledgeRemotionLicense
      style={{ width: "100%", height: "100%" }}
      errorFallback={({ error }) => (
        <PlaybackError error={error} onError={onError} />
      )}
    />
  )
}
export default function Preview(props: Props) {
  const { state, projectId, onPlaying } = props
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(state)
  useEffect(() => {
    latest.current = state
  }, [state])
  const signature = previewSignature(state.document)
  const fail = useCallback(
    (message: string) => {
      setError(message.slice(0, 1000))
      onPlaying(false)
    },
    [onPlaying],
  )
  useEffect(() => {
    const controller = new AbortController()
    const ownedUrls: string[] = []
    const requested = latest.current.document
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setPrepared(null)
        setError("")
      }
    })
    async function prepare(): Promise<BrowserPreview> {
      if (
        !requested.items.some((item) =>
          ["video", "audio", "image", "component"].includes(item.kind),
        )
      )
        return {
          input: { document: requested, media: {}, code: {} },
          urls: {},
          files: [],
        }
      for (let retry = 0; retry < 8; retry++) {
        controller.signal.throwIfAborted()
        const response = await fetch("/api/shorts/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, document: requested }),
          signal: controller.signal,
        })
        if (response.status === 503 && retry < 7) {
          await response.body?.cancel()
          await new Promise((resolve) => setTimeout(resolve, 250))
          continue
        }
        const value = (await response.json()) as BrowserPreview & {
          error?: string
        }
        if (!response.ok)
          throw new StudioPreviewError(value.error ?? "Preview unavailable")
        return value
      }
      throw new StudioPreviewError("Preview remains busy; retry shortly")
    }
    prepare()
      .then((value) => {
        if (
          controller.signal.aborted ||
          previewSignature(latest.current.document) !== signature
        )
          return
        const input = studioPreviewSchema.parse(value.input)
        const mediaUrls = { ...value.urls }
        for (const file of value.files) {
          const bytes = Uint8Array.from(atob(file.base64), (c) =>
            c.charCodeAt(0),
          )
          const url = URL.createObjectURL(
            new Blob([bytes], { type: file.type }),
          )
          ownedUrls.push(url)
          mediaUrls[file.name] = url
        }
        setPrepared({ input, mediaUrls, signature })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          fail(error instanceof Error ? error.message : "Preview failed")
      })
    return () => {
      controller.abort()
      ownedUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [projectId, signature, attempt, fail])
  const ready = prepared?.signature === signature && !error
  return (
    <div className="nle-preview" data-preview-ready={Boolean(ready)}>
      {error ? (
        <div className="nle-preview-message" role="alert">
          <p>{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Retry preview
          </button>
        </div>
      ) : ready && prepared ? (
        <LivePlayer
          key={`${projectId}:${signature}:${attempt}`}
          {...props}
          prepared={prepared}
          onError={fail}
        />
      ) : (
        <div className="nle-preview-message">Preparing live preview…</div>
      )}
    </div>
  )
}
