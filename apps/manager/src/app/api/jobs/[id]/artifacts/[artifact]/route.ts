import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { parseJobArtifactFilename } from "@/lib/job-artifacts"
import { getJob } from "@/lib/state"
import { readArtifact } from "@/services/storage"

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  json: "application/json",
  mp3: "audio/mpeg",
  vtt: "text/vtt",
}

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; artifact: string }>
  },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id, artifact } = await params
  const parsed = parseJobArtifactFilename(artifact)

  if (!parsed) {
    return NextResponse.json(
      { error: "Invalid artifact filename" },
      { status: 400 },
    )
  }

  const job = await getJob(id)
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  try {
    const body = await readArtifact(
      job.muxAssetId,
      parsed.artifactType,
      parsed.ext,
    )
    const responseBody = new Uint8Array(body.byteLength)
    responseBody.set(body)

    return new Response(responseBody, {
      status: 200,
      headers: {
        "content-type":
          CONTENT_TYPE_BY_EXT[parsed.ext] ?? "application/octet-stream",
        "content-disposition": `inline; filename="${artifact}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 })
  }
}
