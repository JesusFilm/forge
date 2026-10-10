import React, { useEffect, useMemo, useRef } from "react"
import * as Remotion from "remotion"
import Hls from "hls.js"
import { transform } from "sucrase"
import {
  parseManifest,
  subtitlesAt,
  StudioProofError,
  type StudioManifest,
} from "./manifest"

export type HostProps = {
  manifest: StudioManifest
  mediaUrl: string
  preview: boolean
}

// Dependency injection is a compatibility boundary, NOT a security sandbox.
// Execute this module only in the opaque preview iframe or isolated renderer.
function compile(source: string): React.ComponentType<Record<string, string>> {
  const code = transform(source, {
    transforms: ["typescript", "jsx", "imports"],
    production: true,
  }).code
  const exports: { default?: React.ComponentType<Record<string, string>> } = {}
  const require = (name: string): unknown => {
    if (name === "react") return React
    if (name === "remotion")
      return {
        useCurrentFrame: Remotion.useCurrentFrame,
        interpolate: Remotion.interpolate,
        AbsoluteFill: Remotion.AbsoluteFill,
      }
    throw new StudioProofError("Unsupported component dependency")
  }
  // Intentional dynamic evaluation: containment belongs to the execution host.
  new Function("React", "Remotion", "exports", "require", code)(
    React,
    require("remotion"),
    exports,
    require,
  )
  if (typeof exports.default !== "function")
    throw new StudioProofError("A default component export is required")
  return exports.default
}

function PreviewMedia({ url, start }: { url: string; start: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!ref.current || !Hls.isSupported()) return
    const hls = new Hls({ autoStartLoad: true, maxBufferLength: 4 })
    hls.loadSource(url)
    hls.attachMedia(ref.current)
    return () => hls.destroy()
  }, [url])
  return (
    <Remotion.Html5Video
      ref={ref}
      src={url}
      trimBefore={start}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  )
}

export function Host({ manifest: input, mediaUrl, preview }: HostProps) {
  const manifest = useMemo(() => parseManifest(input), [input])
  const Generated = useMemo(() => compile(manifest.source), [manifest.source])
  const frame = Remotion.useCurrentFrame()
  const start = (manifest.asset.trimStartMs * manifest.fps) / 1000
  return (
    <Remotion.AbsoluteFill
      data-testid="canvas"
      style={{ backgroundColor: "#102030", fontFamily: "sans-serif" }}
    >
      {mediaUrl ? (
        preview ? (
          <PreviewMedia url={mediaUrl} start={start} />
        ) : (
          <Remotion.OffthreadVideo
            src={mediaUrl}
            trimBefore={start}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )
      ) : null}
      <Generated {...manifest.props} />
      <div
        data-testid="subtitle"
        style={{
          position: "absolute",
          bottom: 12,
          width: "100%",
          textAlign: "center",
          color: "white",
          fontSize: 18,
        }}
      >
        {subtitlesAt(manifest, frame).join("\n")}
      </div>
    </Remotion.AbsoluteFill>
  )
}
