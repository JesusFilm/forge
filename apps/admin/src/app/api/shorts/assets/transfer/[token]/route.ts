import { prisma } from "@/db/client"
import { StudioTransferService } from "@/services/studio-authoring/transfers"
import { ForbiddenError } from "@/services/errors"
import { StudioCommandError } from "@/services/studio-authoring/errors"
import { safeMediaFilename } from "@/storage/media"
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { asset, bytes } = await new StudioTransferService(prisma).download(
      (await params).token,
    )
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": asset.mimeType,
        "content-disposition": `attachment; filename="${safeMediaFilename(asset.filename)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch (error) {
    if (error instanceof ForbiddenError)
      return new Response("Forbidden", { status: 403 })
    throw error
  }
}
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const asset = await new StudioTransferService(prisma).upload(
      (await params).token,
      request.body,
    )
    return Response.json(asset, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    if (error instanceof ForbiddenError)
      return new Response("Forbidden", { status: 403 })
    if (error instanceof StudioCommandError)
      return new Response("Invalid upload", { status: 400 })
    throw error
  }
}
