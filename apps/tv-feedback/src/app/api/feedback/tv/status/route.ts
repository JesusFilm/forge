import { NextResponse } from "next/server"
import { z } from "zod"

import { grantForSecret } from "@/server/feedbackState"
import { hashSecret } from "@/server/tvGrant"

import { readJsonLimited } from "@/server/request"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const parsed = z
    .object({ secret: z.string().min(40).max(100) })
    .strict()
    .safeParse(await readJsonLimited(request).catch(() => null))
  if (!parsed.success)
    return NextResponse.json({ active: false }, { status: 400 })
  const grant = await grantForSecret(hashSecret(parsed.data.secret))
  return NextResponse.json(
    {
      active: Boolean(
        grant &&
        !grant.revoked &&
        !grant.reportId &&
        grant.expiresAt > Date.now(),
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
