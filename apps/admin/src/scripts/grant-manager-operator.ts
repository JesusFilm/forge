import { prisma } from "@/db/client"

async function main() {
  const email = process.argv[2]?.trim().toLowerCase()
  if (!email) {
    throw new Error(
      "Usage: pnpm --filter @forge/admin manager:grant-operator <admin-email>",
    )
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  })

  if (!user) {
    throw new Error(`No Admin user found for ${email}`)
  }

  await prisma.managerMembership.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      role: "OPERATOR",
    },
    update: {
      role: "OPERATOR",
      revokedAt: null,
    },
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
