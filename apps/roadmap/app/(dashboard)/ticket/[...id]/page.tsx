import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { getFeatureById, getLaneLabel } from "@/lib/features"
import StatusBadge from "@/components/StatusBadge"
import PriorityBadge from "@/components/PriorityBadge"
import DependencyList from "@/components/DependencyList"
import MarkdownRenderer from "@/components/MarkdownRenderer"
import { CopyBrainstormButton } from "@/components/CopyBrainstormButton"
import { OwnerAvatar } from "@/components/OwnerAvatar"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string[] }>
}): Promise<Metadata> {
  const { id: idParts } = await params
  const featureId = idParts.join("/")
  const feature = getFeatureById(featureId)
  return {
    title: feature
      ? `${feature.title} | JFP DS AI Roadmap`
      : "Feature | JFP DS AI Roadmap",
  }
}

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ id: string[] }>
}) {
  const { id: idParts } = await params
  const featureId = idParts.join("/")
  const feature = getFeatureById(featureId)

  if (!feature) notFound()

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-stone-400">
          <Link href="/" className="hover:text-white">
            Dashboard
          </Link>
          <span>/</span>
          <Link href={`/lane/${feature.lane}`} className="hover:text-white">
            {getLaneLabel(feature.lane)}
          </Link>
          <span>/</span>
          <span className="hover:text-white">
            <OwnerAvatar owner={feature.owner} size="small" />
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{feature.title}</h1>
          <CopyBrainstormButton filePath={feature.filePath} />
        </div>
      </div>

      {/* Metadata */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-stone-500">
              Status
            </div>
            <StatusBadge status={feature.status} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-stone-500">
              Priority
            </div>
            <PriorityBadge priority={feature.priority} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-stone-500">
              Owner
            </div>
            <span className="text-sm">
              <OwnerAvatar owner={feature.owner} />
            </span>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-stone-500">
              Timeline
            </div>
            <span className="text-sm">{feature.timeline}</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-stone-500">
              Lane
            </div>
            <Link
              href={`/lane/${feature.lane}`}
              className="text-sm text-blue-400 hover:underline"
            >
              {getLaneLabel(feature.lane)}
            </Link>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-stone-500">
              ID
            </div>
            <span className="font-mono text-sm text-stone-300">
              {feature.id}
            </span>
          </div>
        </div>

        {feature.tags.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-medium uppercase text-stone-500">
              Tags
            </div>
            <div className="flex flex-wrap gap-1">
              {feature.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-stone-800 px-2 py-0.5 text-xs text-stone-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {(feature.depends_on.length > 0 || feature.blocks.length > 0) && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <DependencyList label="Depends On" ids={feature.depends_on} />
            <DependencyList label="Blocks" ids={feature.blocks} />
          </div>
        )}
      </div>

      {/* Content */}
      <div>
        <MarkdownRenderer content={feature.content} />
      </div>
    </div>
  )
}
