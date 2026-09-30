/* global document, setTimeout, clearTimeout, URLSearchParams */
/* Loaded on demand. Session-authenticated, read-only reports; no storage or telemetry. */
const make = (tag, text, className) => {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}
const action = (text, label, handler) => {
  const node = make("button", text, "quiet")
  node.type = "button"
  node.setAttribute("aria-label", label)
  node.addEventListener("click", handler)
  return node
}
const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : "—"
const count = (value) => value.toLocaleString()
export function createUsageView(container, { read, onUnauthorized }) {
  let consumers = [],
    page = 0,
    search = "",
    generation = 0,
    reports = new Map()
  let searchTimer
  const size = 20
  const status = make("p", "", "subtle")
  status.setAttribute("role", "status")
  const controls = make("form", undefined, "usage-controls")
  const end = new Date(Math.floor(Date.now() / 60000) * 60000)
  const start = new Date(end.getTime() - 7 * 86400000)
  function field(label, value) {
    const wrapper = make("label", label)
    const input = make("input")
    input.type = "datetime-local"
    input.step = "60"
    input.required = true
    input.value = value.toISOString().slice(0, 16)
    wrapper.append(input)
    controls.append(wrapper)
    return input
  }
  const from = field("From (UTC)", start)
  const to = field("To (UTC, exclusive)", end)
  const apply = make("button", "Update reports")
  apply.type = "submit"
  controls.append(apply)
  const error = make("p", "", "usage-error")
  error.setAttribute("role", "alert")
  const toolbar = make("div", undefined, "toolbar")
  const searchLabel = make("label", "Search consumers", "usage-search")
  const input = make("input")
  input.type = "search"
  input.placeholder = "Search consumers by name…"
  searchLabel.append(input)
  const refresh = action("Refresh", "Refresh usage reports", () => void load())
  toolbar.append(searchLabel, refresh)
  const scroll = make("div", undefined, "table-scroll")
  scroll.setAttribute("role", "region")
  scroll.setAttribute("aria-label", "Consumer usage reports")
  scroll.tabIndex = 0
  const table = make("table", undefined, "usage-table")
  const head = make("thead"),
    heading = make("tr"),
    body = make("tbody")
  for (const [text, css] of [
    ["Consumer", ""],
    ["Requests", "numeric"],
    ["Successful", "numeric"],
    ["Last activity (UTC)", ""],
  ]) {
    const cell = make("th", text, css)
    cell.scope = "col"
    heading.append(cell)
  }
  head.append(heading)
  table.append(head, body)
  scroll.append(table)
  const footer = make("div", undefined, "table-footer")
  const summary = make("span", "", "subtle")
  const pagination = make("div", undefined, "pagination")
  pagination.setAttribute("aria-label", "Usage pages")
  const previous = action("‹", "Previous usage page", () => {
    page--
    void render()
  })
  const next = action("›", "Next usage page", () => {
    page++
    void render()
  })
  const pageNumber = make("span")
  pageNumber.setAttribute("aria-label", "Current usage page")
  pagination.append(previous, pageNumber, next)
  footer.append(summary, pagination)
  const details = make("dialog", undefined, "usage-details")
  details.setAttribute("aria-label", "Report details")
  details.close()
  const note = make(
    "p",
    "Requests include failed attempts. Successful responses have completed with a 2xx status.",
    "usage-note subtle",
  )
  container.replaceChildren(
    controls,
    error,
    toolbar,
    status,
    scroll,
    footer,
    details,
    note,
  )
  function showDetails(report) {
    details.replaceChildren(make("h2", report.label))
    const list = make("dl")
    for (const [label, value] of [
      ["Consumer ID", report.consumerId],
      [
        "Window (UTC)",
        dateTime(report.windowStart) + " – " + dateTime(report.windowEnd),
      ],
      ["Requests", count(report.requestCount)],
      ["Successful", count(report.successfulRequestCount)],
      ["Report generated (UTC)", dateTime(report.generatedAt)],
    ])
      list.append(make("dt", label), make("dd", value))
    details.append(
      list,
      action("Close report", "Close report details", () => {
        details.close()
      }),
    )
    if (!details.open) details.showModal()
  }
  details.addEventListener("close", () => details.replaceChildren())
  function windowQuery() {
    if (!controls.reportValidity()) return null
    const a = new Date(from.value + "Z"),
      b = new Date(to.value + "Z")
    if (
      !Number.isFinite(a.getTime()) ||
      !Number.isFinite(b.getTime()) ||
      a.getTime() % 60000 ||
      b.getTime() % 60000 ||
      b <= a ||
      b - a > 31 * 86400000
    ) {
      error.textContent =
        "Choose a UTC window of up to 31 days, ending after its start, with whole minutes."
      return null
    }
    error.textContent = ""
    return { from: a.toISOString(), to: b.toISOString() }
  }
  function fail(failure) {
    if (failure.code === "unauthorized") {
      clear()
      onUnauthorized()
      return
    }
    error.textContent =
      "Usage reports are unavailable. Refresh to try again. No totals could be read."
  }
  async function render() {
    clearTimeout(searchTimer)
    const selected = ++generation
    details.close()
    reports.clear()
    const matching = consumers.filter((row) =>
      row.name.toLowerCase().includes(search),
    )
    page = Math.max(
      0,
      Math.min(page, Math.max(0, Math.ceil(matching.length / size) - 1)),
    )
    const visible = matching.slice(page * size, (page + 1) * size)
    summary.textContent = `Showing ${visible.length} of ${matching.length} consumers`
    pageNumber.textContent = String(page + 1)
    previous.disabled = page === 0
    next.disabled = (page + 1) * size >= matching.length
    body.replaceChildren()
    const window = windowQuery()
    const entries = new Map()
    for (const row of visible) {
      const tr = make("tr"),
        name = make("th")
      name.scope = "row"
      const displayName = row.name
      const link = action(displayName, "View report for " + displayName, () => {
        const report = reports.get(row.consumerId)
        if (report) showDetails(report)
      })
      link.className = "usage-link"
      link.disabled = true
      name.append(link)
      if (row.state !== "active")
        name.append(make("div", row.state, "subtle usage-state"))
      const requests = make("td", "—", "numeric"),
        success = make("td", "—", "numeric")
      const last = make("td", "—")
      tr.append(name, requests, success, last)
      body.append(tr)
      entries.set(row.consumerId, { link, requests, success, last })
    }
    if (!visible.length) {
      const row = make("tr"),
        cell = make(
          "td",
          consumers.length ? "No matching consumers." : "No consumers yet.",
          "empty",
        )
      cell.colSpan = 4
      row.append(cell)
      body.append(row)
    }
    if (!window || !visible.length) {
      status.textContent = ""
      return
    }
    status.textContent = "Loading reports…"
    try {
      const query = new URLSearchParams({
        ...window,
        consumer: visible.map((row) => row.consumerId).join(","),
      })
      const data = await read("/usage/reports?" + query)
      if (selected !== generation) return
      for (const report of data.reports) {
        const entry = entries.get(report.consumerId)
        if (!entry) continue
        reports.set(report.consumerId, report)
        entry.link.disabled = false
        entry.requests.textContent = count(report.requestCount)
        entry.success.textContent = count(report.successfulRequestCount)
        entry.last.textContent = dateTime(report.lastActivityAt)
      }
      status.textContent =
        "Updated " + dateTime(data.reports[0]?.generatedAt) + " UTC"
    } catch (failure) {
      if (selected !== generation) return
      for (const entry of entries.values()) {
        entry.requests.textContent = "—"
        entry.success.textContent = "—"
        entry.last.textContent = "—"
        entry.link.disabled = true
      }
      status.textContent = ""
      fail(failure)
    }
  }
  async function load() {
    const selected = ++generation
    for (const control of [input, apply, refresh, previous, next])
      control.disabled = true
    details.close()
    reports.clear()
    body.replaceChildren()
    status.textContent = "Loading consumers…"
    error.textContent = ""
    try {
      const data = await read("/consumers/history")
      if (selected !== generation) return
      for (const control of [input, apply, refresh]) control.disabled = false
      consumers = data.consumers.sort((a, b) => a.name.localeCompare(b.name))
      await render()
    } catch (failure) {
      if (selected !== generation) return
      status.textContent = ""
      summary.textContent = ""
      for (const control of [input, apply, refresh]) control.disabled = false
      previous.disabled = true
      next.disabled = true
      fail(failure)
    }
  }
  function clear() {
    clearTimeout(searchTimer)
    for (const control of [input, apply, refresh]) control.disabled = false
    ++generation
    consumers = []
    reports.clear()
    details.replaceChildren()
    details.close()
    body.replaceChildren()
    status.textContent = ""
    summary.textContent = ""
    error.textContent = ""
  }
  controls.addEventListener("submit", (event) => {
    event.preventDefault()
    page = 0
    void render()
  })
  input.addEventListener("input", () => {
    search = input.value.trim().toLowerCase()
    page = 0
    ++generation
    details.close()
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void render(), 200)
  })
  return { load, clear }
}
