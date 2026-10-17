/* global document, URL */
// Display-only catalog. IDs and filters here never enter consumer configuration.
const el = (tag, text, className) => {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}
const number = (value) => value.toLocaleString("en")
const names = new Intl.DisplayNames(["en"], { type: "language" })
function languageName(code) {
  if (code === null) return "Unidentified language"
  if (code === "ber") return "Berber"
  try {
    return names.of(code) || code
  } catch {
    return code
  }
}
const languageLabel = (code) =>
  code === null ? languageName(code) : `${languageName(code)} (${code})`
function action(text, callback, className = "quiet") {
  const button = el("button", text, className)
  button.type = "button"
  button.addEventListener("click", callback)
  return button
}
function search(label, placeholder, value, change) {
  const wrapper = el("label", label, "sources-search")
  const input = el("input")
  input.type = "search"
  input.placeholder = placeholder
  input.value = value
  input.autocomplete = "off"
  input.addEventListener("input", () =>
    change(input.value.trim().toLowerCase()),
  )
  wrapper.append(input)
  return { wrapper, input }
}
function domainLink(host) {
  if (!host) return el("span", "Domain unavailable", "subtle")
  // Snapshot strings are data: reject paths, credentials and non-HTTPS targets.
  try {
    const url = new URL("https://" + host)
    if (
      url.host !== host ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return el("span", host)
    const link = el("a", host)
    link.href = url.href
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    return link
  } catch {
    return el("span", host)
  }
}
function pager(index, total, size, change, label) {
  const pages = Math.max(1, Math.ceil(total / size))
  const group = el("div", undefined, "sources-pagination")
  group.setAttribute("role", "group")
  group.setAttribute("aria-label", label + " pagination")
  const previous = action("‹", () => change(index - 1))
  previous.setAttribute("aria-label", "Previous " + label + " page")
  previous.disabled = index === 0
  const next = action("›", () => change(index + 1))
  next.setAttribute("aria-label", "Next " + label + " page")
  next.disabled = index >= pages - 1
  group.append(previous, el("span", `${index + 1} / ${pages}`), next)
  return group
}
class SourcesViewError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}
let styles
function loadStyles() {
  styles ??= new Promise((resolve, reject) => {
    const link = el("link")
    link.rel = "stylesheet"
    link.href = "/portal/assets/sources.css"
    link.onload = resolve
    link.onerror = () => {
      link.remove()
      styles = null
      reject(new SourcesViewError("sources_styles_unavailable"))
    }
    document.head.append(link)
  })
  return styles
}

export function createSourcesView(root, { read, onUnauthorized }) {
  let generation = 0
  let catalog
  let languageCodes = new Set()
  function languageMatches(code, query) {
    return (
      !query ||
      (languageCodes.has(query)
        ? code === query
        : languageLabel(code).toLowerCase().includes(query))
    )
  }
  let query = ""
  let filter = ""
  let selected
  let tab = "languages"
  let languageQuery = ""
  let sourcePage = 0
  let languagePage = 0
  let ascending = true
  let listing, detail, listStatus
  const sourcePageSize = 8
  const languagePageSize = 8

  function matches() {
    return catalog.sources
      .filter(
        (source) =>
          [
            source.name,
            ...source.domains.map((domain) => domain.host || ""),
          ].some((value) => value.toLowerCase().includes(query)) &&
          (!filter ||
            source.languages.some((language) =>
              languageMatches(language.code, filter),
            )),
      )
      .sort((a, b) => (ascending ? 1 : -1) * a.name.localeCompare(b.name, "en"))
  }
  function choose(source) {
    selected = source.id
    languagePage = 0
    languageQuery = filter
    if (filter) tab = "languages"
    renderList()
    renderDetail()
  }
  function updateFilters() {
    sourcePage = 0
    const sources = matches()
    if (!sources.some((source) => source.id === selected))
      selected = sources[0]?.id
    languagePage = 0
    languageQuery = filter
    if (filter) tab = "languages"
    renderList()
    renderDetail()
  }
  function renderList() {
    listing.replaceChildren()
    const sources = matches()
    sourcePage = Math.min(
      sourcePage,
      Math.max(0, Math.ceil(sources.length / sourcePageSize) - 1),
    )
    const scroll = el("div", undefined, "sources-table-scroll")
    const table = el("table", undefined, "sources-table")
    table.setAttribute("aria-label", "Production sources")
    const head = el("thead")
    const headings = el("tr")
    const name = el("th")
    name.scope = "col"
    name.setAttribute("aria-sort", ascending ? "ascending" : "descending")
    name.append(
      action(
        "Source " + (ascending ? "↑" : "↓"),
        () => {
          ascending = !ascending
          sourcePage = 0
          renderList()
          listing.querySelector("thead button").focus()
        },
        "sources-sort",
      ),
    )
    headings.append(name)
    for (const title of ["Total documents", "Detected languages"]) {
      const cell = el("th", title)
      cell.scope = "col"
      headings.append(cell)
    }
    head.append(headings)
    const body = el("tbody")
    for (const source of sources.slice(
      sourcePage * sourcePageSize,
      (sourcePage + 1) * sourcePageSize,
    )) {
      const row = el(
        "tr",
        undefined,
        selected === source.id ? "sources-selected" : "",
      )
      const title = el("th")
      title.scope = "row"
      const select = action(
        source.name,
        () => {
          choose(source)
          listing.querySelector('[aria-pressed="true"]')?.focus()
        },
        "sources-select",
      )
      select.setAttribute("aria-pressed", String(selected === source.id))
      const domainCount = source.domains.filter((domain) => domain.host).length
      select.append(
        el(
          "span",
          source.domains.length === 1
            ? source.domains[0].host || "Domain unavailable"
            : `Multiple domains · ${domainCount}`,
          "subtle sources-host",
        ),
      )
      title.append(select)
      row.append(
        title,
        el("td", number(source.documents)),
        el(
          "td",
          number(
            source.languages.filter((language) => language.code !== null)
              .length,
          ),
        ),
      )
      body.append(row)
    }
    table.append(head, body)
    scroll.append(table)
    listing.append(scroll)
    if (!sources.length)
      listing.append(
        el("p", "No production sources match these filters.", "empty"),
      )
    const footer = el("div", undefined, "sources-footer")
    const start = sources.length ? sourcePage * sourcePageSize + 1 : 0
    footer.append(
      el(
        "span",
        `${start}–${Math.min((sourcePage + 1) * sourcePageSize, sources.length)} of ${sources.length} sources`,
        "subtle",
      ),
      pager(
        sourcePage,
        sources.length,
        sourcePageSize,
        (index) => {
          sourcePage = index
          renderList()
          listing.querySelector("tbody button")?.focus()
        },
        "sources",
      ),
    )
    listing.append(footer)
    listStatus.textContent = `${sources.length} production sources match. Counts are totals for each source.`
  }
  function renderDetail() {
    detail.replaceChildren()
    const source = matches().find((entry) => entry.id === selected)
    if (!source) {
      detail.append(
        el("p", "Select a source to explore its production content.", "empty"),
      )
      return
    }
    const heading = el("div", undefined, "sources-detail-heading")
    heading.append(el("h2", source.name))
    if (source.domains.length === 1)
      heading.append(domainLink(source.domains[0].host))
    else
      heading.append(
        el(
          "span",
          `${source.domains.filter((domain) => domain.host).length} production domains`,
          "subtle",
        ),
      )
    const documents = el("p", undefined, "sources-documents")
    documents.append(
      el("strong", number(source.documents)),
      el("span", "total documents", "subtle"),
    )
    heading.append(documents)
    detail.append(heading)
    const tabs = el("div", undefined, "sources-tabs")
    tabs.setAttribute("role", "group")
    tabs.setAttribute("aria-label", "Source details")
    for (const value of ["overview", "languages"]) {
      const control = action(
        value === "overview" ? "Overview" : "Languages",
        () => {
          tab = value
          renderDetail()
          detail.querySelector('[aria-pressed="true"]')?.focus()
        },
        tab === value ? "selected" : "",
      )
      control.setAttribute("aria-pressed", String(tab === value))
      tabs.append(control)
    }
    detail.append(tabs)
    if (tab === "overview") {
      detail.append(
        el(
          "p",
          "Indexed production documents, grouped by content brand. Counts include unidentified-language documents and do not imply unique articles across domains.",
          "sources-explanation",
        ),
      )
      const domains = el("ul", undefined, "sources-domains")
      for (const domain of source.domains) {
        const item = el("li")
        item.append(
          domainLink(domain.host),
          el("span", `${number(domain.documents)} documents`, "subtle"),
        )
        domains.append(item)
      }
      detail.append(domains)
      return
    }
    const searchControl = search(
      "Search detected languages",
      "Language name or code…",
      languageQuery,
      (value) => {
        languageQuery = value
        languagePage = 0
        renderLanguages(source, results)
      },
    )
    detail.append(searchControl.wrapper)
    const results = el("div")
    detail.append(results)
    renderLanguages(source, results)
  }
  function renderLanguages(source, container) {
    container.replaceChildren()
    const languages = source.languages
      .filter((language) => languageMatches(language.code, languageQuery))
      .sort((a, b) =>
        a.code === null
          ? 1
          : b.code === null
            ? -1
            : languageName(a.code).localeCompare(languageName(b.code), "en"),
      )
    languagePage = Math.min(
      languagePage,
      Math.max(0, Math.ceil(languages.length / languagePageSize) - 1),
    )
    const list = el("div", undefined, "sources-language-list")
    list.setAttribute("aria-label", "Detected language coverage")
    const header = el("div", undefined, "sources-language-header")
    header.append(el("span", "Detected language"), el("span", "Documents"))
    list.append(header)
    for (const language of languages.slice(
      languagePage * languagePageSize,
      (languagePage + 1) * languagePageSize,
    )) {
      const row = el("details", undefined, "sources-language")
      // A catalog language selection reveals the contributing domains immediately.
      row.open = Boolean(filter && languageMatches(language.code, filter))
      const summary = el("summary")
      const title = el("span", languageName(language.code))
      if (language.code && languageName(language.code) !== language.code)
        title.append(el("span", language.code, "sources-language-code subtle"))
      if (language.domains.some((domain) => domain.unexpected))
        title.append(
          el("span", "Outside expected languages", "sources-language-warning"),
        )
      if (language.domains.some((domain) => domain.expectationUnknown))
        title.append(
          el(
            "span",
            "Expected languages unavailable",
            "sources-language-warning",
          ),
        )
      summary.append(title, el("span", number(language.documents)))
      row.append(summary)
      const domains = el("ul", undefined, "sources-domains")
      for (const domain of language.domains) {
        const item = el("li")
        const description = el("div")
        description.append(domainLink(domain.host))
        if (domain.unexpected)
          description.append(
            el(
              "span",
              "Outside this domain’s expected languages",
              "sources-language-warning",
            ),
          )
        if (domain.expectationUnknown)
          description.append(
            el(
              "span",
              "Expected languages unavailable",
              "sources-language-warning",
            ),
          )
        item.append(description, el("span", number(domain.documents), "subtle"))
        domains.append(item)
      }
      row.append(domains)
      list.append(row)
    }
    container.append(list)
    if (!languages.length)
      container.append(
        el("p", "No detected languages match this search.", "empty"),
      )
    const footer = el("div", undefined, "sources-footer")
    footer.append(
      el(
        "span",
        `${languages.length} language ${languages.length === 1 ? "entry" : "entries"}`,
        "subtle",
      ),
      pager(
        languagePage,
        languages.length,
        languagePageSize,
        (index) => {
          languagePage = index
          renderLanguages(source, container)
          container.querySelector("summary")?.focus()
        },
        "languages",
      ),
    )
    container.append(
      footer,
      el(
        "p",
        "Languages are detected from document content; labels have not been verified. Expand a language to see its contributing domains.",
        "sources-explanation",
      ),
    )
    const unknown = source.languages.find((language) => language.code === null)
    if (unknown)
      container.append(
        el(
          "p",
          `${number(unknown.documents)} documents have no detected language. They are included in this source’s total.`,
          "sources-explanation",
        ),
      )
  }
  function render() {
    root.replaceChildren()
    const summary = el("div", undefined, "sources-summary")
    for (const [value, label] of [
      [catalog.totals.sources, "sources in production"],
      [catalog.totals.languages, "detected languages"],
      [catalog.totals.documents, "documents"],
    ]) {
      const metric = el("div")
      metric.append(el("strong", number(value)), el("span", label, "subtle"))
      summary.append(metric)
    }
    const timestamp = el("div", undefined, "sources-snapshot")
    const time = el(
      "time",
      new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(catalog.observedAt)) + " UTC",
    )
    time.dateTime = catalog.observedAt
    timestamp.append(el("span", "Production snapshot", "subtle"), time)
    summary.append(timestamp)
    root.append(summary)
    const layout = el("div", undefined, "sources-layout")
    const master = el("div", undefined, "sources-panel")
    detail = el("section", undefined, "sources-panel sources-detail")
    detail.setAttribute("aria-label", "Selected source")
    const toolbar = el("div", undefined, "sources-toolbar")
    toolbar.append(
      search("Search sources", "Source name or domain…", query, (value) => {
        query = value
        updateFilters()
      }).wrapper,
    )
    const language = search(
      "Filter by language",
      "All detected languages",
      filter,
      (value) => {
        filter = value
        updateFilters()
      },
    )
    language.input.setAttribute("list", "sources-language-options")
    const options = el("datalist")
    options.id = "sources-language-options"
    const codes = [
      ...new Set(
        catalog.sources.flatMap((source) =>
          source.languages.map((entry) => entry.code),
        ),
      ),
    ].sort((a, b) => languageName(a).localeCompare(languageName(b), "en"))
    for (const code of codes) {
      const option = el("option")
      option.value = languageLabel(code)
      options.append(option)
    }
    toolbar.append(language.wrapper, options)
    listStatus = el("p", undefined, "sr-only")
    listStatus.setAttribute("role", "status")
    listing = el("div")
    master.append(toolbar, listStatus, listing)
    layout.append(master, detail)
    root.append(layout)
    updateFilters()
  }
  async function load() {
    const started = ++generation
    root.replaceChildren(el("p", "Loading production sources…", "empty"))
    root.setAttribute("aria-busy", "true")
    try {
      const [data] = await Promise.all([read("/sources"), loadStyles()])
      if (started !== generation) return
      catalog = data
      languageCodes = new Set(
        catalog.sources.flatMap((source) =>
          source.languages.map((language) => language.code),
        ),
      )
      render()
    } catch (error) {
      if (started !== generation) return
      if (error.code === "unauthorized") {
        onUnauthorized()
        return
      }
      const message = el(
        "p",
        "The production snapshot is unavailable. Try again.",
        "empty",
      )
      message.setAttribute("role", "alert")
      root.replaceChildren(
        message,
        action("Retry sources", () => void load()),
      )
    } finally {
      if (started === generation) root.removeAttribute("aria-busy")
    }
  }
  return {
    load,
    clear() {
      generation++
      catalog = null
      root.replaceChildren()
      root.removeAttribute("aria-busy")
    },
  }
}
