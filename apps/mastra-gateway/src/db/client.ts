import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as {
  mastraGatewayPrisma?: PrismaClient
}

export const prisma =
  globalForPrisma.mastraGatewayPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.mastraGatewayPrisma = prisma
}
