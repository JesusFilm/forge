import { prisma } from "@/db/client"
import { grantManagerAccess } from "@/services/user-access.service"

async function main() {
  const email = process.argv[2]?.trim().toLowerCase()
  if (!email) {
    throw new Error(
      "Usage: pnpm --filter @forge/admin manager:grant-operator <admin-email>",
    )
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true },
  })

  if (!user) {
    throw new Error(`No Admin user found for ${email}`)
  }

  if (user.role !== "ADMIN") {
    throw new Error(
      "manager:grant-operator requires the target account to be an Admin so the self-grant remains actor-bound and auditable",
    )
  }

  await grantManagerAccess({
    user: { id: user.id, role: "ADMIN" },
    targetUserId: user.id,
  })

  console.log(`Granted ManagerRole.OPERATOR to ${user.email}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
