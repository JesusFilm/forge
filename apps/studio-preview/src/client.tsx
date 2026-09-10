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
    player = useRef<PlayerRef>(null)
  useEffect(() => {
    let active = true
    fetch(new URL("input.json", location.href))
      .then((r) => r.json())
      .then((raw) => {
        const parsed = studioPreviewSchema.parse(raw)
        if (parsed.document.runtimeVersion !== STUDIO_RUNTIME_VERSION)
          throw new StudioRuntimeError("Unsupported runtime version")
        if (active) setInput(parsed)
      })
      .catch(() =>
        send({ type: "error", message: "Preview session unavailable" }),
      )
    const timer = setInterval(() => send({ type: "heartbeat" }), 300)
    const receive = (e: MessageEvent) => {
      if (e.source !== window.parent) return
      try {
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
      clearInterval(timer)
      window.removeEventListener("message", receive)
    }
  }, [])
  useEffect(() => {
    if (!input || !player.current) return
    const p = player.current
    const update = () => send({ type: "frame", frame: p.getCurrentFrame() })
    p.addEventListener("frameupdate", update)
    send({ type: "ready" })
    return () => p.removeEventListener("frameupdate", update)
  }, [Boolean(input)])
  return input ? (
    <Boundary>
      <Player
        ref={player}
        component={Composition}
        inputProps={{ input }}
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
