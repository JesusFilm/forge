import { prisma } from "@/db/client"
import { purgeExpiredUserPlaylistReportSensitiveMaterial } from "@/services/user-playlist-report.service"

async function run() {
  const result = await purgeExpiredUserPlaylistReportSensitiveMaterial(prisma)
  console.log(
    JSON.stringify({
      event: "user_playlist_report_sensitive_material_purge",
      ...result,
    }),
  )
}

run().finally(async () => prisma.$disconnect())
