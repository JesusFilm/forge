"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The server log (`server-log.jsonl`): one JSON object per request. A
// synchronous append keeps every line that was answered, even after a crash.

const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

function createLog(logPath) {
  let fd = null
  return {
    open() {
      if (fd !== null) return
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      fd = fs.openSync(logPath, "a")
    },
    write(entry) {
      if (fd === null) throw new Error(`the server log ${logPath} is not open`)
      fs.writeSync(fd, `${JSON.stringify(entry)}\n`)
    },
    close() {
      if (fd === null) return
      fs.closeSync(fd)
      fd = null
    },
  }
}

module.exports = { createLog, sha256 }
