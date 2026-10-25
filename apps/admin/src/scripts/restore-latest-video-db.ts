import { restoreLatestMain } from "./video-db-backup"

restoreLatestMain().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
