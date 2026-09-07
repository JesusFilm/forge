import React, { useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import * as Remotion from "remotion"
import { Player, type PlayerRef } from "@remotion/player"
import Hls from "hls.js"
import { transform } from "sucrase"
import {
  studioPreviewSchema,
  STUDIO_RUNTIME_VERSION,
  type StudioPreview,
} from "@forge/studio-contracts/preview"
import {
  studioDocumentSchema,
  type StudioTimelineItem,
} from "@forge/studio-contracts"
class StudioRuntimeError extends Error {}

const send = (data: unknown) => window.parent.postMessage(data, "*")
function compile(source: string) {
  const code = transform(source, {
    transforms: ["typescript", "jsx", "imports"],
    production: true,
  }).code
  const exports: {
    default?: React.ComponentType<Record<string, string | number | boolean>>
  } = {}
  const require = (name: string) => {
    if (name === "react") return React
    if (name === "remotion")
      return {
        AbsoluteFill: Remotion.AbsoluteFill,
        useCurrentFrame: Remotion.useCurrentFrame,
        useVideoConfig: Remotion.useVideoConfig,
        interpolate: Remotion.interpolate,
        spring: Remotion.spring,
        Sequence: Remotion.Sequence,
        Easing: Remotion.Easing,
      }
    throw new StudioRuntimeError("Unsupported dependency")
  }
  // Generated evaluation occurs ONLY in this distinct-site sandboxed browser document.
  new Function("React", "exports", "require", code)(React, exports, require)
  if (typeof exports.default !== "function")
    throw new StudioRuntimeError("Default component export required")
  return exports.default
}
function HlsVideo({
  url,
  start,
  volume,
}: {
  url: string
  start: number
  volume: number
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const onError = () =>
      send({ type: "error", message: "Source media could not decode" })
    video.addEventListener("error", onError)
    let hls: Hls | undefined
    if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 6,
        maxMaxBufferLength: 12,
        enableWorker: true,
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) onError()
      })
      hls.loadSource(url)
      hls.attachMedia(video)
    }
    return () => {
      hls?.destroy()
      video.removeEventListener("error", onError)
    }
  }, [url])
  return (
    <Remotion.Html5Video
      ref={ref}
      src={url}
      trimBefore={start}
      volume={volume}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  )
}
function Layer({
  item,
  input,
  compiled,
}: {
  item: StudioTimelineItem
  input: StudioPreview
  compiled: Record<
    string,
    React.ComponentType<Record<string, string | number | boolean>>
  >
}) {
  const media = input.media[item.id],
    url = media ? new URL(media.file, location.href).href : "",
    fps = input.document.fps
  const t = item.transform ?? {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    },
    crop = t.crop
  const style: React.CSSProperties = {
    transform: `translate(${t.x}px,${t.y}px) rotate(${t.rotation}deg) scale(${t.scaleX},${t.scaleY})`,
    opacity: t.opacity,
    clipPath: crop
      ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
      : undefined,
  }
  const Component =
    item.kind === "component" ? compiled[item.componentVersionId] : null
  return (
    <Remotion.AbsoluteFill style={style}>
      {item.kind === "text" ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent:
              item.properties.align === "left"
                ? "flex-start"
                : item.properties.align === "right"
                  ? "flex-end"
                  : "center",
            whiteSpace: "pre-wrap",
            color: item.properties.color ?? "white",
            fontSize: item.properties.fontSize ?? 72,
            fontFamily: item.properties.fontFamily ?? "sans-serif",
            fontWeight: item.properties.fontWeight ?? 500,
            textAlign: item.properties.align ?? "center",
          }}
        >
          {item.text}
        </div>
      ) : item.kind === "component" && Component ? (
        <Component {...item.properties} />
      ) : item.kind === "video" && media ? (
        <HlsVideo
          url={url}
          start={((item.source.startMs - media.sourceStartMs) * fps) / 1000}
          volume={item.volume}
        />
      ) : item.kind === "audio" && media ? (
        <Remotion.Html5Audio
          src={url}
          trimBefore={(item.sourceStartMs * fps) / 1000}
          volume={item.volume}
        />
      ) : item.kind === "image" && media ? (
        <Remotion.Img
          src={url}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
    </Remotion.AbsoluteFill>
  )
}
function Composition({ input }: { input: StudioPreview }) {
  const activeVersions = JSON.stringify(
    [
      ...new Set(
        input.document.items.flatMap((item) =>
          item.kind === "component" ? [item.componentVersionId] : [],
        ),
      ),
    ].sort(),
  )
  const compiled = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(input.code)
          .filter(([id]) =>
            (JSON.parse(activeVersions) as string[]).includes(id),
          )
          .map(([id, source]) => [id, compile(source)]),
      ),
    [input.code, activeVersions],
  )
  return (
    <Remotion.AbsoluteFill style={{ backgroundColor: "black" }}>
      {input.document.tracks.map((t) =>
        input.document.items
          .filter((i) => i.trackId === t.id)
          .map((i) => (
            <Remotion.Sequence
              key={i.id}
              from={i.startFrame}
              durationInFrames={i.durationInFrames}
            >
              <Layer item={i} input={input} compiled={compiled} />
            </Remotion.Sequence>
          )),
      )}
    </Remotion.AbsoluteFill>
  )
}
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
