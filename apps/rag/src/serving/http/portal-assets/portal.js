/* global document, window, navigator, fetch */
/* Browser-only portal client. No storage, telemetry or automatic mutation retries. */
const byId = (id) => document.getElementById(id)
const dialog = byId("workflow")
let identity = null
let rows = []
let busy = false
let secret = null
let revision = 0
let lifecycle = 0
let section = "consumers"
let usageView = null
let usageModule = null
let sourcesView = null
let sourcesModule = null
let statusFilter = "all"
let searchTerm = ""
let ascending = true
let pageIndex = 0
const pageSize = 20
const rowMenu = byId("row-menu")
function dismissRowMenu() {
  rowMenu.hidePopover()
  rowMenu.replaceChildren()
}
function showSection(next) {
  if (busy) return
  close()
  dismissRowMenu()
  if (next !== section) notice("")
  section = next
  document.querySelectorAll("[data-section]").forEach((node) => {
    const selected = node.dataset.section === next
    node.classList.toggle("selected", selected)
    if (selected) node.setAttribute("aria-current", "page")
    else node.removeAttribute("aria-current")
  })
  byId("page-title").textContent = {
    rag: "RAG",
    knowledge: "Knowledge",
    consumers: "Consumers",
    usage: "Usage",
    sources: "Sources",
  }[next]
  byId("page-description").hidden = !["consumers", "usage"].includes(next)
  byId("page-description").textContent =
    next === "usage"
      ? "RAG requests and completed responses across all consumers."
      : "Manage API consumers, their members and access keys."
  byId("directory").hidden =
    next !== "consumers" || !identity?.managementAvailable
  byId("signed-out").hidden =
    !["consumers", "usage", "sources"].includes(next) || Boolean(identity)
  byId("construction").hidden = ["consumers", "usage", "sources"].includes(next)
  byId("sources").hidden = next !== "sources" || !identity
  if (next !== "sources") sourcesView?.clear()
  if (next === "sources" && identity) void showSources()
  byId("usage").hidden = next !== "usage" || !identity
  if (next !== "usage") usageView?.clear()
  if (next === "usage" && identity) void showUsage()
  document.title = "Forge · " + byId("page-title").textContent
}

async function showSources() {
  try {
    sourcesModule ??= import("./sources.js")
    const module = await sourcesModule
    if (!identity || section !== "sources") return
    sourcesView ??= module.createSourcesView(byId("sources"), {
      read: request,
      onUnauthorized: () => {
        signedOut()
        notice(messages.unauthorized)
      },
    })
    await sourcesView.load()
  } catch {
    sourcesModule = null
    if (identity && section === "sources")
      notice("Sources are unavailable. Refresh to try again.")
  }
}

async function showUsage() {
  if (!identity.usageAvailable) {
    byId("usage").textContent = "Usage reporting is not enabled yet."
    return
  }
  try {
    usageModule ??= import("./usage.js")
    const module = await usageModule
    if (!identity || section !== "usage") return
    usageView ??= module.createUsageView(byId("usage"), {
      read: request,
      onUnauthorized: () => {
        signedOut()
        notice(messages.unauthorized)
      },
    })
    await usageView.load()
  } catch {
    usageModule = null
    if (identity && section === "usage")
      notice("Usage reports are unavailable. Refresh to try again.")
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (["input", "form", "select", "textarea"].includes(tag))
    node.setAttribute("autocomplete", "off")
  if (className) node.className = className
  return node
}
function button(text, action, className = "quiet") {
  const node = element("button", text, className)
  node.type = "button"
  node.addEventListener("click", action)
  return node
}
function actionIcon(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("aria-hidden", "true")
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", d)
    svg.append(path)
  }
  return svg
}
const menuIcons = {
  Members: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75",
    "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  ],
  "Generate new key": [
    "M21 7a5 5 0 0 1-7.4 4.4L5 20H2v-3l8.6-8.6A5 5 0 1 1 21 7",
    "M16 7h.01",
  ],
  Suspend: ["M8 3v18M16 3v18"],
  Resume: ["m8 3 12 9-12 9z"],
  Recover: ["M3 12a9 9 0 1 0 9-9M3 3v9h9"],
  Delete: ["M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"],
}
const messages = {
  unauthorized: "Your session has ended or access has changed. Sign in again.",
  forbidden:
    "This action is unavailable. Membership or access may have changed.",
  conflict:
    "The name is already used or another member changed this consumer. Refresh and review before trying again.",
  invalid: "Check the consumer name and selected member.",
  missing: "This consumer is no longer available. Refresh the directory.",
}
class PortalError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}
async function request(path, body, method = "GET") {
  let response
  try {
    response = await fetch("/portal" + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      ...(method === "GET"
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    })
  } catch {
    throw new PortalError("network")
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new PortalError(data?.error || "unavailable")
  if (!data) throw new PortalError("network")
  return data
}
function notice(text) {
  byId("notice").textContent = text
}
function clearSecret() {
  secret = null
  byId("dialog-content").replaceChildren()
}
function close() {
  if (busy) return
  clearSecret()
  dialog.close()
}
function form(title, description) {
  clearSecret()
  const content = byId("dialog-content")
  const heading = element("h2", title)
  heading.id = "dialog-title"
  const error = element("p")
  error.id = "dialog-error"
  error.setAttribute("role", "alert")
  content.append(heading)
  if (description) content.append(element("p", description, "subtle"))
  content.append(error)
  if (!dialog.open) dialog.showModal()
  return content
}
function showError(error, issuance) {
  const message =
    messages[error.code] ||
    (issuance
      ? "The result could not be confirmed. Refresh the directory. If creation succeeded or the key was replaced, generate a new key; the previous response cannot be recovered."
      : "The result could not be confirmed. Refresh and review the current state before trying again.")
  notice(message)
  if (error.code === "unauthorized") {
    clearSecret()
    dialog.close()
    signedOut()
  } else {
    close()
  }
}
async function mutate(
  path,
  body,
  method = "POST",
  issuance = false,
  onSuccess,
) {
  if (busy) return
  const started = lifecycle
  busy = true
  document.querySelectorAll("button").forEach((node) => {
    node.disabled = true
  })
  let result, failure
  try {
    result = await request(path, body, method)
  } catch (error) {
    failure = error
  }
  if (started !== lifecycle) return
  busy = false
  document.querySelectorAll("button").forEach((node) => {
    node.disabled = false
  })
  if (failure) {
    if (failure.code !== "unauthorized") await refresh().catch(() => {})
    showError(failure, issuance)
    return
  }
  if (onSuccess) onSuccess(result)
  else {
    close()
    notice("Changes saved.")
  }
  if (identity?.managementAvailable)
    await refresh().catch(() => {
      notice("Changes saved. The directory could not refresh; try Refresh.")
    })
}
function issued(result, name) {
  const content = form("Save your API key", "Consumer: " + name)
  secret = result.secret
  const key = element("p", secret, "secret")
  key.setAttribute("aria-label", "One-time API key")
  content.append(
    element(
      "p",
      "Save this key in your password manager now. It is shown once and cannot be recovered. Keep it out of logs and source control.",
      "warning",
    ),
    key,
  )
  const actions = element("div", undefined, "actions")
  actions.append(
    button("Copy key", async (event) => {
      try {
        await navigator.clipboard.writeText(secret)
        event.target.textContent = "Copied"
      } catch {
        const error = byId("dialog-error")
        if (error)
          error.textContent =
            "Copy was blocked. Select the key and copy it manually."
      }
    }),
    button(
      "I’ve saved the key",
      () => {
        close()
        notice("")
      },
      "",
    ),
  )
  content.append(actions)
}
function create() {
  const content = form("Create consumer")
  const fields = element("form")
  const nameLabel = element("label", "Consumer name")
  const input = element("input")
  input.name = "name"
  input.placeholder = "e.g. ragbot"
  input.maxLength = 80
  input.pattern = "[a-z0-9\\-]+"
  input.required = true
  input.addEventListener("input", () => input.setCustomValidity(""))
  input.addEventListener("invalid", () => {
    input.setCustomValidity(
      input.validity.patternMismatch
        ? "Use lowercase letters, numbers or dashes."
        : "Enter a consumer name.",
    )
  })
  nameLabel.append(input)
  const ownerLabel = element("label", "Initial owner")
  const owner = element("input")
  owner.value = identity.login
  owner.readOnly = true
  ownerLabel.append(owner)
  const actions = element("div", undefined, "actions")
  const submit = button("Create", () => {}, "")
  submit.type = "submit"
  actions.append(button("Cancel", close), submit)
  fields.append(nameLabel, ownerLabel, actions)
  fields.addEventListener("submit", (event) => {
    event.preventDefault()
    if (!fields.reportValidity()) return
    const name = input.value
    void mutate("/consumers", { name }, "POST", true, (result) =>
      issued(result, name),
    )
  })
  content.append(fields)
  input.focus()
}
function confirm(title, description, label, action, danger = false) {
  const content = form(title, description)
  const actions = element("div", undefined, "actions")
  actions.append(
    button("Cancel", close),
    button(label, action, danger ? "danger" : ""),
  )
  content.append(actions)
}
function confirmDelete(row) {
  const content = form(
    "Delete consumer?",
    `This permanently disables ${row.name} and frees its name. Usage and audit history remain. Type the consumer name to confirm.`,
  )
  const label = element("label", "Consumer name")
  const input = element("input")
  input.setAttribute("autocomplete", "off")
  label.append(input)
  const actions = element("div", undefined, "actions")
  const remove = button(
    "Delete consumer",
    () =>
      mutate(
        "/consumers/" + row.consumerId,
        { name: input.value, expectedVersion: row.lifecycleVersion },
        "DELETE",
      ),
    "danger",
  )
  remove.disabled = true
  input.addEventListener("input", () => {
    remove.disabled = input.value !== row.name
  })
  actions.append(button("Cancel", close), remove)
  content.append(label, actions)
  input.focus()
}
async function members(row) {
  const selectedRevision = ++revision
  const content = form(
    "Members · " + row.name,
    "Every member can manage this consumer and replace its API key.",
  )
  content.append(element("p", "Loading members…"))
  try {
    const [membership, directory] = await Promise.all([
      request("/consumers/" + row.consumerId + "/members"),
      request("/members"),
    ])
    if (!dialog.open || selectedRevision !== revision) return
    const body = form(
      "Members · " + row.name,
      "Every member can manage this consumer and replace its API key.",
    )
    const path = "/consumers/" + row.consumerId + "/members"
    for (const member of membership.members) {
      const user = directory.users.find(
        (user) => String(user.id) === member.githubUserId,
      )
      const line = element("div", undefined, "member")
      line.append(
        element(
          "span",
          user ? "@" + user.login : "GitHub account " + member.githubUserId,
        ),
      )
      const remove = button("Remove", () =>
        confirm(
          "Remove member?",
          "They will lose management access. Rotate the API key if they should also lose retrieval access.",
          "Remove member",
          () =>
            mutate(
              path + "/" + encodeURIComponent(member.githubUserId),
              { expectedVersion: row.membershipVersion },
              "DELETE",
            ),
          true,
        ),
      )
      remove.disabled =
        membership.members.length <= 1 ||
        (row.state !== "active" && row.state !== "suspended")
      line.append(remove)
      body.append(line)
    }
    if (row.state === "active" || row.state === "suspended") {
      const label = element("label", "Add member")
      const select = element("select")
      select.setAttribute("aria-label", "Add member")
      const placeholder = element("option", "Select an approved GitHub user")
      placeholder.value = ""
      select.append(placeholder)
      for (const user of directory.users.filter(
        (user) =>
          !membership.members.some(
            (member) => member.githubUserId === String(user.id),
          ),
      )) {
        const option = element("option", "@" + user.login)
        option.value = String(user.id)
        select.append(option)
      }
      label.append(select)
      body.append(label)
      const actions = element("div", undefined, "actions")
      const add = button(
        "Add member",
        () => {
          if (select.value)
            void mutate(path, {
              githubUserId: Number(select.value),
              expectedVersion: row.membershipVersion,
            })
        },
        "",
      )
      add.disabled = true
      select.addEventListener("change", () => {
        add.disabled = !select.value
      })
      actions.append(button("Done", close), add)
      body.append(actions)
    } else {
      const actions = element("div", undefined, "actions")
      actions.append(button("Done", close))
      body.append(actions)
    }
  } catch (error) {
    showError(error, false)
  }
}
function render() {
  dismissRowMenu()
  const container = byId("rows")
  container.replaceChildren()
  const matching = rows
    .filter(
      (row) =>
        (statusFilter === "all" || row.state === statusFilter) &&
        row.name.toLowerCase().includes(searchTerm),
    )
    .sort((a, b) => (ascending ? 1 : -1) * a.name.localeCompare(b.name))
  const pages = Math.max(1, Math.ceil(matching.length / pageSize))
  pageIndex = Math.min(pageIndex, pages - 1)
  const visible = matching.slice(
    pageIndex * pageSize,
    (pageIndex + 1) * pageSize,
  )
  byId("result-count").textContent =
    `Showing ${visible.length} of ${matching.length} consumers`
  byId("page-number").textContent = String(pageIndex + 1)
  byId("previous-page").disabled = pageIndex === 0
  byId("next-page").disabled = pageIndex >= pages - 1
  if (!matching.length) {
    const row = element("tr")
    const cell = element(
      "td",
      rows.length ? "No matching consumers." : "No consumers yet.",
      "empty",
    )
    cell.colSpan = 4
    row.append(cell)
    container.append(row)
    return
  }
  for (const row of visible) {
    const entry = element("tr")
    const name = element("th", row.name, "consumer-name")
    name.scope = "row"
    const state = element("td")
    state.append(element("span", row.state, "badge " + row.state))
    const actionCell = element("td")
    const count = row.memberCount
    const memberCount = element(
      "td",
      `${count} ${count === 1 ? "member" : "members"}`,
      "member-count",
    )
    entry.append(name, state, memberCount, actionCell)
    if (row.owned) {
      const actions = element("div", undefined, "menu-actions")
      actions.append(
        button("Members", () => {
          void members(row)
        }),
      )
      const path = "/consumers/" + row.consumerId
      if (row.state === "active" || row.state === "suspended") {
        actions.append(
          button("Generate new key", () =>
            confirm(
              "Generate new key?",
              "The current key stops working immediately. Coordinate with every caller and save the replacement in your password manager.",
              "Generate new key",
              () =>
                mutate(
                  path + "/rotate",
                  { expectedVersion: row.credentialVersion, reason: "routine" },
                  "POST",
                  true,
                  (result) => issued(result, row.name),
                ),
            ),
          ),
        )
        const next = row.state === "active" ? "suspended" : "active"
        const label = next === "active" ? "Resume" : "Suspend"
        actions.append(
          button(label, () =>
            confirm(
              label + " consumer?",
              "Suspended consumers cannot retrieve content. You can resume them later.",
              label,
              () =>
                mutate(path + "/state", {
                  state: next,
                  expectedVersion: row.lifecycleVersion,
                }),
            ),
          ),
        )
      } else if (row.state === "revoked") {
        actions.append(
          button("Recover", () =>
            confirm(
              "Recover consumer?",
              "The revoked key stays invalid. A new key is issued once; save it before closing this dialog.",
              "Recover and issue key",
              () =>
                mutate(
                  path + "/recover",
                  {
                    expectedVersion: row.credentialVersion,
                    expectedLifecycleVersion: row.lifecycleVersion,
                  },
                  "POST",
                  true,
                  (result) => issued(result, row.name),
                ),
            ),
          ),
        )
      }
      actions.append(button("Delete", () => confirmDelete(row), "danger"))
      const trigger = button(
        "⋮",
        () => {
          dismissRowMenu()
          rowMenu.append(actions)
          rowMenu.showPopover()
          const rect = trigger.getBoundingClientRect()
          rowMenu.style.left =
            Math.max(
              8,
              Math.min(
                window.innerWidth - rowMenu.offsetWidth - 8,
                rect.right - rowMenu.offsetWidth,
              ),
            ) + "px"
          rowMenu.style.top =
            Math.max(
              8,
              Math.min(
                window.innerHeight - rowMenu.offsetHeight - 8,
                rect.bottom + 6,
              ),
            ) + "px"
          actions.querySelector("button")?.focus()
        },
        "quiet action-trigger",
      )
      trigger.setAttribute("aria-label", "Actions for " + row.name)
      trigger.setAttribute("aria-haspopup", "true")
      actions.querySelectorAll("button").forEach((item) => {
        item.prepend(actionIcon(menuIcons[item.textContent]))
        item.addEventListener("click", dismissRowMenu)
      })
      actionCell.append(trigger)
    }
    container.append(entry)
  }
}
async function refresh() {
  const data = await request("/consumers")
  rows = data.consumers
  const revokedFilter = document.querySelector('[data-filter="revoked"]')
  revokedFilter.hidden = !rows.some((row) => row.state === "revoked")
  if (revokedFilter.hidden && statusFilter === "revoked") {
    statusFilter = "all"
    document.querySelectorAll("[data-filter]").forEach((node) => {
      const selected = node.dataset.filter === "all"
      node.classList.toggle("selected", selected)
      node.setAttribute("aria-pressed", String(selected))
    })
  }
  render()
}
function signedOut() {
  usageView?.clear()
  sourcesView?.clear()
  identity = null
  rows = []
  byId("rows").replaceChildren()
  byId("create").hidden = true
  byId("refresh").hidden = true
  byId("directory").hidden = true
  byId("signed-out").hidden = false
  byId("account").replaceChildren()
  dismissRowMenu()
  showSection(section)
}
async function initialize() {
  document.querySelectorAll("button").forEach((node) => {
    node.disabled = false
  })
  try {
    identity = await request("/identity")
    byId("signed-out").hidden = true
    const account = byId("account")
    account.replaceChildren(
      element("span", "@" + identity.login, "subtle"),
      button("Sign out", () => {
        close()
        void mutate("/sign-out", {}, "POST", false, () => {
          signedOut()
          notice("")
        })
      }),
    )
    if (!identity.managementAvailable) {
      notice("Consumer management is not enabled yet.")
      showSection(section)
      return
    }
    await refresh()
    byId("create").hidden = false
    byId("refresh").hidden = false
    showSection(section)
  } catch (error) {
    signedOut()
    if (error.code !== "unauthorized")
      notice("The portal is unavailable. Refresh to try again.")
  }
}
byId("create").addEventListener("click", () => create())
byId("refresh").addEventListener("click", () => {
  close()
  notice("")
  void refresh().catch((error) => showError(error, false))
})
dialog.addEventListener("cancel", (event) => {
  event.preventDefault()
  close()
})
dialog.addEventListener("close", () => {
  ++revision
  clearSecret()
})
window.addEventListener("pagehide", () => {
  ++lifecycle
  busy = false
  close()
  signedOut()
})
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void initialize()
})

document
  .querySelectorAll("[data-section]")
  .forEach((node) =>
    node.addEventListener("click", () => showSection(node.dataset.section)),
  )
document.querySelectorAll("[data-filter]").forEach((node) =>
  node.addEventListener("click", () => {
    statusFilter = node.dataset.filter
    pageIndex = 0
    document.querySelectorAll("[data-filter]").forEach((item) => {
      const selected = item.dataset.filter === statusFilter
      item.classList.toggle("selected", selected)
      item.setAttribute("aria-pressed", String(selected))
    })
    render()
  }),
)
byId("search").addEventListener("input", (event) => {
  searchTerm = event.target.value.trim().toLowerCase()
  pageIndex = 0
  render()
})
byId("sort-name").addEventListener("click", () => {
  ascending = !ascending
  byId("name-column").setAttribute(
    "aria-sort",
    ascending ? "ascending" : "descending",
  )
  byId("sort-direction").textContent = ascending ? "↑" : "↓"
  render()
})
byId("previous-page").addEventListener("click", () => {
  pageIndex--
  render()
})
byId("next-page").addEventListener("click", () => {
  pageIndex++
  render()
})
rowMenu.addEventListener("keydown", (event) => {
  const items = [...rowMenu.querySelectorAll("button")]
  const index = items.indexOf(document.activeElement)
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault()
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
    items[next]?.focus()
  }
})
void initialize()
