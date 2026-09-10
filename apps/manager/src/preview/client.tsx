import React, { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Player, type PlayerRef } from "@remotion/player"
import {
  studioPreviewSchema,
  STUDIO_RUNTIME_VERSION,
  type StudioPreview,
} from "@forge/studio-contracts/preview"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { StudioComposition as Composition } from "@forge/shorts-compositions/studio/Composition"
class StudioRuntimeError extends Error {}
const send = (data: unknown) => window.parent.postMessage(data, "*")
class Boundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    send({ type: "error", message: error.message.slice(0, 1000) })
  }
  render() {
    return this.state.failed ? <p>Preview failed</p> : this.props.children
  }
}
function App() {
  const [input, setInput] = useState<StudioPreview | null>(null),
    [mediaUrls, setMediaUrls] = useState<Record<string, string>>({}),
    player = useRef<PlayerRef>(null)
  useEffect(() => {
    let active = true
    const ownedUrls: string[] = []
    send({ type: "boot" })
    const timer = setInterval(() => {
      send({ type: "heartbeat" })
      if (active) send({ type: "boot" })
    }, 300)
    const receive = (e: MessageEvent) => {
      if (e.source !== window.parent) return
      try {
        if (e.data?.type === "initialize" && active) {
          const parsed = studioPreviewSchema.parse(e.data.input)
          if (parsed.document.runtimeVersion !== STUDIO_RUNTIME_VERSION)
            throw new StudioRuntimeError("Unsupported runtime version")
          const urls: Record<string, string> = { ...e.data.urls }
          for (const file of e.data.files) {
            const bytes = Uint8Array.from(atob(file.base64), (c) =>
              c.charCodeAt(0),
            )
            const url = URL.createObjectURL(
              new Blob([bytes], { type: file.type }),
            )
            ownedUrls.push(url)
            urls[file.name] = url
          }
          setMediaUrls(urls)
          setInput(parsed)
          active = false
        }
        if (e.data?.type === "document") {
          const document = studioDocumentSchema.parse(e.data.document)
          setInput((old) => (old ? { ...old, document } : old))
        }
        if (
          e.data?.type === "seek" &&
          Number.isInteger(e.data.frame) &&
          e.data.frame >= 0
        )
          player.current?.seekTo(e.data.frame)
        if (e.data?.type === "play") player.current?.play()
        if (e.data?.type === "pause") player.current?.pause()
      } catch {
        send({ type: "error", message: "Invalid preview update" })
      }
    }
    window.addEventListener("message", receive)
    return () => {
      active = false
      ownedUrls.forEach((url) => URL.revokeObjectURL(url))
      clearInterval(timer)
      window.removeEventListener("message", receive)
    }
  }, [])
  const hasInput = input !== null
  useEffect(() => {
    if (!hasInput || !player.current) return
    const p = player.current
    const update = () => send({ type: "frame", frame: p.getCurrentFrame() })
    p.addEventListener("frameupdate", update)
    send({ type: "ready" })
    return () => p.removeEventListener("frameupdate", update)
  }, [hasInput])
  return input ? (
    <Boundary>
      <Player
        ref={player}
        component={Composition}
        inputProps={{
          input,
          mediaUrls,
          mediaBaseUrl: "https://preview.invalid/",
        }}
        compositionWidth={input.document.width}
        compositionHeight={input.document.height}
        durationInFrames={input.document.durationInFrames}
        fps={input.document.fps}
        // Shared audio tags resolve against window.origin, which is null in this sandbox.
        numberOfSharedAudioTags={0}
        acknowledgeRemotionLicense
        style={{ width: "100%", height: "100%" }}
        errorFallback={({ error }) => {
          send({ type: "error", message: error.message.slice(0, 1000) })
          return <p>Preview failed</p>
        }}
      />
    </Boundary>
  ) : null
}
window.addEventListener("error", () =>
  send({ type: "error", message: "Preview execution failed" }),
)
createRoot(document.getElementById("root")!).render(<App />)
