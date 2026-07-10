import { PrismaClient } from "../generated/prisma/index.js"

const globalForPrisma = globalThis as unknown as {
  ytVideoMapperPrisma?: PrismaClient
}

export const prisma =
  globalForPrisma.ytVideoMapperPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.ytVideoMapperPrisma = prisma
}
