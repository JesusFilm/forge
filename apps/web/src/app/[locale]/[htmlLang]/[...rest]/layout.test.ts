import { describe, expect, it } from "vitest"

import { initialWatchRouteSurface } from "./layout"

describe("initialWatchRouteSurface", () => {
  it("uses the admitted internal shape to seed ambiguous one-segment routes", () => {
    expect(initialWatchRouteSurface(["new-collection.html"])).toBe("experience")
    expect(initialWatchRouteSurface(["russian.html"])).toBe("language-home")
    expect(initialWatchRouteSurface(["jesus.html", "english.html"])).toBe(
      "english-video",
    )
  })

  it("leaves international and contextual route chrome to pathname parsing", () => {
    expect(initialWatchRouteSurface(["jesus.html", "romanian.html"])).toBeNull()
    expect(
      initialWatchRouteSurface(["jesus.html", "the-beginning", "english.html"]),
    ).toBeNull()
  })
})
