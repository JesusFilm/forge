import { describe, expect, it } from "vitest"
import {
  admitExperienceEditorRequest,
  registerPublicGraphqlAdmission,
  withPublicGraphqlPriority,
} from "./public-request-priority"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe("public request priority", () => {
  it("defers editor admission by one event-loop turn", async () => {
    let admitted = false
    const request = admitExperienceEditorRequest().then(() => {
      admitted = true
    })

    expect(admitted).toBe(false)
    await request
    expect(admitted).toBe(true)
  })

  it("waits for public work registered at the proxy boundary", async () => {
    registerPublicGraphqlAdmission()
    const releasePublic = deferred()
    let editorAdmitted = false
    const editorRequest = admitExperienceEditorRequest().then(() => {
      editorAdmitted = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(editorAdmitted).toBe(false)

    const publicRequest = withPublicGraphqlPriority(() => releasePublic.promise)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(editorAdmitted).toBe(false)

    releasePublic.resolve()
    await Promise.all([publicRequest, editorRequest])
    expect(editorAdmitted).toBe(true)
  })

  it("lets an active public request finish before admitting the editor", async () => {
    const publicStarted = deferred()
    const releasePublic = deferred()
    const publicRequest = withPublicGraphqlPriority(async () => {
      publicStarted.resolve()
      await releasePublic.promise
    })
    await publicStarted.promise

    let editorAdmitted = false
    const editorRequest = admitExperienceEditorRequest().then(() => {
      editorAdmitted = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(editorAdmitted).toBe(false)

    releasePublic.resolve()
    await Promise.all([publicRequest, editorRequest])
    expect(editorAdmitted).toBe(true)
  })

  it("waits until all active public work completes", async () => {
    const releaseFirst = deferred()
    const releaseSecond = deferred()
    const first = withPublicGraphqlPriority(() => releaseFirst.promise)
    const second = withPublicGraphqlPriority(() => releaseSecond.promise)
    let editorAdmitted = false
    const editor = admitExperienceEditorRequest().then(() => {
      editorAdmitted = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(editorAdmitted).toBe(false)

    releaseFirst.resolve()
    await first
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(editorAdmitted).toBe(false)

    releaseSecond.resolve()
    await Promise.all([second, editor])
    expect(editorAdmitted).toBe(true)
  })

  it("admits the editor on the next turn when no public request is active", async () => {
    await expect(admitExperienceEditorRequest()).resolves.toBeUndefined()
  })

  it("caps the wait when public traffic remains active", async () => {
    const releasePublic = deferred()
    const publicRequest = withPublicGraphqlPriority(() => releasePublic.promise)
    const startedAt = Date.now()

    await expect(admitExperienceEditorRequest()).resolves.toBeUndefined()
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200)

    releasePublic.resolve()
    await publicRequest
  })
})
