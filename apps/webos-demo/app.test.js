const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { test } = require("node:test")

function harness({ failFirstAttachment = false } = {}) {
  const elements = new Map()
  const frames = []
  const instances = []
  let attach
  const attached = new Promise((resolve) => {
    attach = resolve
  })
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set()
      elements.set(id, {
        textContent: id,
        src: "poster.jpg",
        hidden: id === "player",
        style: {},
        dataset: {},
        disabled: false,
        paused: true,
        plays: 0,
        classList: {
          add: (value) => classes.add(value),
          remove: (value) => classes.delete(value),
          contains: (value) => classes.has(value),
        },
        setAttribute() {},
        addEventListener() {},
        focus() {},
        querySelector: () => element(`${id}-label`),
        pause() {
          this.paused = true
        },
        async play() {
          this.plays++
          this.paused = false
        },
      })
    }
    return elements.get(id)
  }
  class Player {
    constructor() {
      this.loads = []
      this.attached = false
      instances.push(this)
    }
    static isBrowserSupported() {
      return true
    }
    async attach() {
      await attached
      if (failFirstAttachment && instances[0] === this)
        throw new Error("attach failed")
      this.attached = true
    }
    async destroy() {}
    async load(url) {
      assert.equal(this.attached, true)
      this.loads.push(url)
    }
    async unload() {}
    configure() {}
    addEventListener() {}
    getTextTracks() {
      return [{ language: "en" }]
    }
    selectTextTrack() {}
  }
  const context = vm.createContext({
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    window: {
      shaka: { Player, polyfill: { installAll() {} } },
      addEventListener() {},
      setTimeout() {},
      clearTimeout() {},
    },
    requestAnimationFrame: (callback) => frames.push(callback),
  })
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "app.js"), "utf8"),
    context,
  )
  return {
    open: () => vm.runInContext("openPlayer()", context),
    close: () => vm.runInContext("closePlayer()", context),
    attach,
    frames,
    instances,
    element,
  }
}

test("Back during attachment prevents a hidden HLS load", async () => {
  const app = harness()
  const opening = app.open()
  app.close()
  app.attach()
  await opening
  assert.deepEqual(app.instances[0].loads, [])
  assert.equal(app.element("demo-video").plays, 0)
})

test("rapid reopen waits for the shared attachment", async () => {
  const app = harness()
  const first = app.open()
  app.close()
  const second = app.open()
  app.attach()
  await Promise.all([first, second])
  assert.equal(app.instances.length, 1)
  assert.equal(app.instances[0].loads.length, 1)
  assert.equal(app.element("demo-video").plays, 1)
  assert.equal(app.element("player-status").dataset.state, "ready")
})

test("Back invalidates a queued reveal animation", async () => {
  const app = harness()
  const opening = app.open()
  app.close()
  app.frames.forEach((callback) => callback())
  assert.equal(app.element("player").classList.contains("visible"), false)
  app.attach()
  await opening
})

test("failed attachment can be retried with a fresh player", async () => {
  const app = harness({ failFirstAttachment: true })
  const first = app.open()
  app.attach()
  await first
  assert.equal(app.element("player-status").dataset.state, "error")
  app.close()
  await app.open()
  assert.equal(app.instances.length, 2)
  assert.equal(app.instances[1].loads.length, 1)
  assert.equal(app.element("demo-video").plays, 1)
})
