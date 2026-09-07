import { PrismaClient } from "/home/tataihono/.codex/worktrees/06c1/forge/apps/admin/node_modules/@prisma/client/index.js"
async function main() {
  process.env.WEB_REVALIDATE_URL = "http://127.0.0.1:34674/api/revalidate"
  process.env.WEB_REVALIDATE_TOKEN = "test-revalidation-secret"
  const { reconcileStudioWatch } =
    await import("/home/tataihono/.codex/worktrees/06c1/forge/apps/admin/src/services/studio-authoring/watch-delivery")
  const db = new PrismaClient()
  try {
    console.log(
      "CHAIN_RESULT " + JSON.stringify(await reconcileStudioWatch(db)),
    )
  } finally {
    await db.$disconnect()
  }
}
void main()
