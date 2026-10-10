// Local-only qualification bootstrap. Never imported by the application.
import { readFile } from "node:fs/promises"
async function main() {
  Object.assign(
    process.env,
    JSON.parse(await readFile(process.argv[2], "utf8")),
  )
  const { installLoopbackFetchGuard, serve } =
    await import("../../../scripts/studio-agent-local/http.mjs")
  installLoopbackFetchGuard()
  const { prisma } = await import("../src/db/client")
  await prisma.user.upsert({
    where: { id: "shorts-local-qualification" },
    update: {},
    create: {
      id: "shorts-local-qualification",
      email: "shorts-local-qualification@example.test",
      name: "Local qualification operator",
      role: "EDITOR",
      managerMembership: { create: { role: "OPERATOR" } },
    },
  })
  const delegated = await import("../src/app/api/shorts/delegated/route")
  const interactive = await import("../src/app/api/shorts/interactive/route")
  const session = await import("../src/app/api/manager/session/route")
  serve(55472, {
    "POST /api/shorts/delegated": delegated.POST,
    "POST /api/shorts/interactive": interactive.POST,
    "POST /api/manager/session": session.POST,
  })
}
void main()
