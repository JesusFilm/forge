import { NextResponse } from "next/server"
import { prisma } from "@/db/client"
import { publicMediaAssetPreviewUrl } from "@/services/media-asset.service"
import { readMediaObject } from "@/storage/media"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; variant: string }> },
) {
  const { id, variant } = await params
  if (variant !== "preview") {
    return new NextResponse("Not found", { status: 404 })
  }

  const asset = await prisma.mediaAsset.findFirst({
    where: {
      id,
      status: "READY",
      visibility: "PUBLIC",
    },
    select: {
      id: true,
      backend: true,
      status: true,
      visibility: true,
      mimeType: true,
      objectKey: true,
      previewObjectKey: true,
      muxPlaybackId: true,
    },
  })

  if (!asset) {
    return new NextResponse("Not found", { status: 404 })
  }

  if (asset.backend === "MUX") {
    const url = publicMediaAssetPreviewUrl(asset)
    return url
      ? NextResponse.redirect(url)
      : new NextResponse("Not found", { status: 404 })
  }

  const key = asset.previewObjectKey ?? asset.objectKey
  if (!key) {
    return new NextResponse("Not found", { status: 404 })
  }

  const bytes = await readMediaObject({ backend: asset.backend, key })
  const headers = new Headers({
    "content-type": asset.mimeType,
    "cache-control": "public, max-age=3600, s-maxage=86400",
  })
  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)

  return new NextResponse(new Blob([body], { type: asset.mimeType }), {
    headers,
  })
}
