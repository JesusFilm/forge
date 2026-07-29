import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  buildDevotionsAugustCollection,
  findCellById,
  formatCellDate,
} from "@/features/video-pipelines/video-pipeline-model"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Preview -- Video Pipelines -- Studio",
}

export default async function VideoPipelinePreviewPage({
  params,
}: {
  params: Promise<{ cellId: string }>
}) {
  const { cellId } = await params
  const collection = buildDevotionsAugustCollection()
  const cell = findCellById(collection, cellId)

  if (!cell) {
    notFound()
  }

  return (
    <div className="studio-page">
      <Link href="/dashboard/video-pipelines" className="pipeline-preview-back">
        Devotions - August
      </Link>

      <header className="studio-page-intro">
        <div className="studio-page-intro-copy">
          <span className="studio-page-eyebrow">Video production</span>
          <h1>{cell.title}</h1>
          <p>{formatCellDate(cell.date)}</p>
        </div>
      </header>

      <div className="pipeline-preview-grid">
        <section className="pipeline-preview-panel">
          <h2>Mobile</h2>
          {cell.mobileGenerated && cell.thumbnailUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              className="pipeline-preview-media pipeline-preview-media--mobile"
              src={cell.thumbnailUrl}
              alt={`${cell.title} — mobile cut`}
            />
          ) : (
            <div className="pipeline-preview-media pipeline-preview-media--mobile pipeline-preview-media--empty">
              Not generated yet
            </div>
          )}
        </section>

        <section className="pipeline-preview-panel">
          <h2>Desktop</h2>
          {cell.desktopGenerated && cell.thumbnailUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              className="pipeline-preview-media pipeline-preview-media--desktop"
              src={cell.thumbnailUrl}
              alt={`${cell.title} — desktop cut`}
            />
          ) : (
            <div className="pipeline-preview-media pipeline-preview-media--desktop pipeline-preview-media--empty">
              Not generated yet
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
