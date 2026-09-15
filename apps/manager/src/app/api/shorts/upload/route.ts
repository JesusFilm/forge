import { NextResponse } from "next/server"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import {
  authenticateStudioRequest,
  readStudioBody,
  StudioRequestTooLarge,
} from "@/lib/studio-request"
import { createStudioInteractiveClient } from "@/backend/studio-interactive"
import { env } from "@/config/env"
class StudioUploadError extends Error {}
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const body = await readStudioBody(request, 17 * 1024 * 1024)
    const data = await new Response(body, {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData(),
      file = data.get("file")
    if (!(file instanceof File) || file.size > 16 * 1024 * 1024 || !file.size)
      return new Response("Choose a file up to 16 MiB", { status: 400 })
    const role = z
      .enum(["background", "music", "component"])
      .parse(data.get("role"))
    if (role === "component" && file.size > 32768)
      return new Response("Component exceeds 32 KiB", { status: 400 })
    const bytes = Buffer.from(await file.arrayBuffer()),
      call = createStudioInteractiveClient(actor)
    const grant = z.object({ path: z.string() }).parse(
      await call("asset-upload", {
        metadata: {
          filename: file.name,
          mimeType: role === "component" ? "text/plain" : file.type,
          role,
          idempotencyKey: randomUUID(),
          provenance: { status: "unknown", recorded: {} },
        },
        digest: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.length,
      }),
    )
    if (!grant.path.startsWith("/api/shorts/assets/transfer/"))
      throw new StudioUploadError("Invalid grant")
    const response = await fetch(new URL(grant.path, env.ADMIN_GRAPHQL_URL!), {
      method: "PUT",
      body: bytes,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new StudioUploadError("Upload failed")
    return Response.json(await response.json(), {
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    if (error instanceof StudioRequestTooLarge)
      return new Response(null, { status: 413 })
    return Response.json(
      { error: "Could not retain this asset" },
      { status: 400 },
    )
  }
}
