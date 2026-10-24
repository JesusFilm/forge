import React, { useState, useRef } from "react"
import { createRoot } from "react-dom/client"
import { Composition, registerRoot } from "remotion"
import { Player, type PlayerRef } from "@remotion/player"
import { Host, type HostProps } from "./Host"
import { exampleManifest } from "./example"
import { parseManifest } from "./manifest"

const defaults: HostProps = {
  manifest: exampleManifest,
  mediaUrl: "",
  preview: false,
}
function Root() {
  return (
    <Composition
      id="StudioProof"
      component={Host}
      width={320}
      height={180}
      fps={30}
      durationInFrames={60}
      defaultProps={defaults}
      calculateMetadata={({ props }) => {
        const m = parseManifest(props.manifest)
        return {
          width: m.width,
          height: m.height,
          fps: m.fps,
          durationInFrames: m.durationInFrames,
        }
      }}
    />
  )
}
function Preview() {
  const [props, setProps] = useState<HostProps | null>(null)
  const player = useRef<PlayerRef>(null)
  React.useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (e.source !== window.parent) return
      if (e.data?.type === "load") {
        const manifest = parseManifest(e.data.manifest)
        // The trusted harness alone selects a broker path; no arbitrary asset URL.
        setProps({
          manifest,
          mediaUrl: new URL("/media/preview.m3u8", location.href).href,
          preview: true,
        })
      }
      if (
        e.data?.type === "seek" &&
        Number.isInteger(e.data.frame) &&
        e.data.frame >= 0 &&
        e.data.frame < 300
      )
        player.current?.seekTo(e.data.frame)
    }
    window.addEventListener("message", receive)
    window.parent.postMessage({ type: "ready" }, "*")
    return () => window.removeEventListener("message", receive)
  }, [])
  return props ? (
    <Player
      ref={player}
      component={Host}
      inputProps={props}
      compositionWidth={props.manifest.width}
      compositionHeight={props.manifest.height}
      durationInFrames={props.manifest.durationInFrames}
      fps={30}
      controls
      acknowledgeRemotionLicense
      style={{ width: props.manifest.width }}
    />
  ) : (
    <p>Waiting for manifest</p>
  )
}
if (new URLSearchParams(location.search).has("preview")) {
  createRoot(document.getElementById("video-container")!).render(<Preview />)
} else registerRoot(Root)
