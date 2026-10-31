import { notFound } from "next/navigation"

import {
  PhotoFeedbackFlow,
  type PreviewStage,
} from "@/components/PhotoFeedbackFlow"

const stages: PreviewStage[] = ["photo", "draw", "editor", "send", "received"]

export const dynamic = "force-dynamic"

export default async function PreviewFrame({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; embed?: string }>
}) {
  if (process.env.NODE_ENV !== "development") notFound()
  const params = await searchParams
  const stage = stages.find((value) => value === params.stage) ?? "photo"
  return (
    <>
      {params.embed !== "1" ? (
        <nav className="preview-stage-nav" aria-label="Preview screens">
          <a href="/tv/preview">All screens</a>
          {stages.map((name) => (
            <a
              key={name}
              href={`/tv/preview/frame?stage=${name}`}
              aria-current={stage === name ? "page" : undefined}
            >
              {name}
            </a>
          ))}
        </nav>
      ) : null}
      <PhotoFeedbackFlow
        tvContext={{ platform: "apple-tv", appVersion: "1.0.0", build: "11" }}
        advancedHref="/tv/advanced?platform=apple-tv"
        previewStage={stage}
      />
    </>
  )
}
