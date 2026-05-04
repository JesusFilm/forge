import { NextResponse } from "next/server"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { createServices } from "@/services"
import { mediaAssetPreviewUrl } from "@/services/media-asset.service"
import { readMediaObject, safeMediaFilename } from "@/storage/media"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variant: string }> },
) {
  const user = await requireSession()
  const { id, variant } = await params
  if (variant !== "preview" && variant !== "download") {
    return new NextResponse("Not found", { status: 404 })
  }

  const services = createServices(prisma)
  const asset = await services.mediaAsset.getById({
    id,
    user,
    query: {},
  })

  if (!asset) {
    return new NextResponse("Not found", { status: 404 })
  }

  if (variant === "preview" && asset.backend === "MUX") {
    const url = mediaAssetPreviewUrl(asset)
    return url
      ? NextResponse.redirect(url)
      : new NextResponse("Not found", { status: 404 })
  }

  const key =
    variant === "preview"
      ? (asset.previewObjectKey ?? asset.objectKey)
      : asset.objectKey

  if (!key || asset.backend === "MUX") {
    return new NextResponse("Not found", { status: 404 })
  }

  const bytes = await readMediaObject({ backend: asset.backend, key })
  const headers = new Headers({
    "content-type": asset.mimeType,
    "cache-control": "private, max-age=60",
  })

  if (variant === "download") {
    const filename = safeMediaFilename(asset.originalFilename ?? `${asset.id}`)
    headers.set("content-disposition", `attachment; filename="${filename}"`)
  }

  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)

  return new NextResponse(new Blob([body], { type: asset.mimeType }), {
    headers,
  })
}
