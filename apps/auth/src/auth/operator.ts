import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/auth/config"
import { getAuthBaseUrl, getAuthOperatorEmails } from "@/config/env"
import { prisma } from "@/db/client"

export function canAccessAuthOperator({
  email,
  membershipStatus,
  operatorEmails,
  nodeEnv,
}: {
  email: string
  membershipStatus: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED"
  operatorEmails: readonly string[]
  nodeEnv: string | undefined
}) {
  if (membershipStatus !== "ACTIVE") return false

  if (operatorEmails.length === 0) {
    return nodeEnv !== "production"
  }

  return operatorEmails.includes(email.toLowerCase())
}

export async function requireAuthOperator() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    const loginUrl = new URL("/login", getAuthBaseUrl())
    loginUrl.searchParams.set("callbackURL", `${getAuthBaseUrl()}/dashboard`)
    redirect(loginUrl.toString() as Parameters<typeof redirect>[0])
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      membershipStatus: true,
    },
  })

  if (
    !user ||
    !canAccessAuthOperator({
      email: user.email,
      membershipStatus: user.membershipStatus,
      operatorEmails: getAuthOperatorEmails(),
      nodeEnv: process.env.NODE_ENV,
    })
  ) {
    redirect("/login?error=forbidden")
  }

  return user
}
