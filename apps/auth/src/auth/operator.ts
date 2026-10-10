import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/auth/config"
import { prisma } from "@/db/client"

export function canAccessAuthOperator({
  actorType,
  membershipStatus,
  nodeEnv,
}: {
  actorType?: "HUMAN" | "AGENT" | null
  membershipStatus: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED"
  nodeEnv: string | undefined
}) {
  if (membershipStatus !== "ACTIVE") return false
  if (actorType === "AGENT") return false

  return nodeEnv !== "production"
}

export async function requireAuthOperator() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    redirect("/login")
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      actorType: true,
      membershipStatus: true,
    },
  })

  if (
    !user ||
    !canAccessAuthOperator({
      membershipStatus: user.membershipStatus,
      actorType: user.actorType,
      nodeEnv: process.env.NODE_ENV,
    })
  ) {
    redirect("/login?error=forbidden")
  }

  return user
}
