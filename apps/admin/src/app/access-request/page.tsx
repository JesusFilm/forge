import { cookies } from "next/headers"
import {
  ADMIN_OAUTH_ACCESS_REQUEST_COOKIE,
  readAdminOAuthAccessRequestCookie,
} from "@/auth/auth-session"
import { AccessRequestPageClient } from "@/app/access-request/access-request-page-client"
import { prisma } from "@/db/client"

type AccessStatus = "approved" | "pending" | "available" | "unavailable"

export default async function AccessRequestPage() {
  const cookieStore = await cookies()
  const accessRequest = await readAdminOAuthAccessRequestCookie(
    cookieStore.get(ADMIN_OAUTH_ACCESS_REQUEST_COOKIE)?.value,
  )
  const accessStatus = await resolveAccessStatus(accessRequest)

  return (
    <AccessRequestPageClient
      accessStatus={accessStatus}
      accountEmail={accessRequest?.email}
      accountName={accessRequest?.name}
    />
  )
}

async function resolveAccessStatus(
  accessRequest: Awaited<ReturnType<typeof readAdminOAuthAccessRequestCookie>>,
): Promise<AccessStatus> {
  if (!accessRequest) return "unavailable"

  const existingByEmail = accessRequest.email
    ? await prisma.user.findUnique({
        where: { email: accessRequest.email },
        select: { role: true },
      })
    : null
  const existingBySubject = await prisma.user.findUnique({
    where: { id: accessRequest.subject },
    select: { role: true },
  })
  const user = existingByEmail ?? existingBySubject

  if (!user) return "available"
  return user.role === "ADMIN" || user.role === "EDITOR"
    ? "approved"
    : "pending"
}
