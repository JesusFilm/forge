import type { Metadata } from "next"
import { SubtitleEditorApp } from "@/components/subtitle-editor-app"
import { decodeLaunchEnvelope } from "@/lib/editor-helpers"

export const metadata: Metadata = {
  title: "Subtitle Review Editor",
}

type PageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
}

function getSingleSearchParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return null
}

export default async function Page({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams
  const launch = getSingleSearchParam(resolvedSearchParams?.launch)
  const jobId = getSingleSearchParam(resolvedSearchParams?.jobId)
  const parsedLaunch = launch
    ? (decodeLaunchEnvelope(launch) ??
      (jobId ? { jobId, launchCode: launch } : null))
    : null

  return (
    <SubtitleEditorApp
      initialLaunch={launch}
      initialLaunchEnvelope={parsedLaunch}
    />
  )
}
