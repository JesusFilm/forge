import { NextResponse } from "next/server"
import { z } from "zod"

import { isValidGatewayAdminBearer } from "@/auth/admin-api-bearer"
import { createGatewayStudioAccessService } from "@/services/studio-access.factory"
import type { StudioAccessRecord } from "@/services/studio-access.service"

const lookupSchema = z.object({
  emails: z.array(z.string().min(1)).max(100),
})

const updateSchema = z.object({
  email: z.string().min(1),
  name: z.string().min(1).optional(),
  role: z.enum(["editor", "none"]),
  approvedBy: z.string().min(1).max(128).optional(),
})

export async function POST(request: Request) {
  if (!isValidGatewayAdminBearer(request.headers.get("authorization"))) {
    return unauthorized()
  }

  const body = await readJson(request)
  const parsed = lookupSchema.safeParse(body)
  if (!parsed.success) return invalidRequest()

  const records = await createGatewayStudioAccessService().listByEmails(
    parsed.data.emails,
  )

  return NextResponse.json({ records: records.map(toApiRecord) })
}

export async function PATCH(request: Request) {
  if (!isValidGatewayAdminBearer(request.headers.get("authorization"))) {
    return unauthorized()
  }

  const body = await readJson(request)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return invalidRequest()

  const service = createGatewayStudioAccessService()
  const record =
    parsed.data.role === "none"
      ? await service.revokeByEmail({ email: parsed.data.email })
      : await service.approveByEmail({
          email: parsed.data.email,
          name: parsed.data.name,
          role: "editor",
          approvedBy: parsed.data.approvedBy ?? "admin-api",
        })

  return NextResponse.json({ record: record ? toApiRecord(record) : null })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function toApiRecord(record: StudioAccessRecord) {
  return {
    email: record.email,
    status: record.status,
    role: record.role,
  }
}

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

function invalidRequest() {
  return NextResponse.json({ error: "invalid_request" }, { status: 400 })
}
