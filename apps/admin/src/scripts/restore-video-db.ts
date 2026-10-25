#!/usr/bin/env tsx

import { main } from "./video-db-backup"

main("restore").catch((err) => {
  process.stderr.write(
    `[video-db-restore] ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
})
